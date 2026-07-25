// PURE pakka-invoice arithmetic (03 §8) — no DB, no Prisma, fully unit-testable.
// This is the load-bearing money/tax math the S4 validation gate grades:
//   - discount-before-tax (line discount + a bill discount spread across lines),
//   - MRP-inclusive back-calc (taxable = price × 100 / (100 + rate)),
//   - place-of-supply split (intra-state CGST+SGST vs inter-state IGST),
//   - per-invoice round-to-rupee with a single round_off line.
// All amounts are decimal.js rupees here; the service converts paise→rupees at the
// boundary and persists Prisma Decimals. NO float touches tax or totals (03 A1).
import Decimal from "decimal.js";
import { computeLineTax, backCalcTaxable } from "../shared/tax";
import { roundToRupee } from "../shared/money";

export interface LineInput {
  /** Effective per-sale-unit price in RUPEES (after any manual override is chosen). */
  unitPrice: Decimal.Value;
  /** Sale quantity (decimal). */
  qty: Decimal.Value;
  /** GST rate percent (e.g. 18). */
  gstRatePct: Decimal.Value;
  /** Per-line flat discount in RUPEES, applied before tax. */
  lineDiscount?: Decimal.Value;
  /** True when `unitPrice` is MRP/tax-inclusive (03 §8 back-calc). */
  priceInclusive?: boolean;
}

export interface ComputedLine {
  /** Gross = unitPrice × qty (before discount), rupees. */
  gross: Decimal;
  /** The discount actually applied to this line (line discount + its share of the bill discount). */
  discount: Decimal;
  /** Taxable value after discount, before tax (03 §8) — the value persisted on InvoiceLine. */
  taxableValue: Decimal;
  gstRatePct: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  /** Line total = taxable + its taxes (rupees, unrounded). */
  lineTotal: Decimal;
}

export interface InvoiceTotals {
  lines: ComputedLine[];
  taxableTotal: Decimal;
  discountTotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
  /** Total before round-off (taxable + all taxes), rupees. */
  preRoundTotal: Decimal;
  /** Round-off delta (grand − preRound). 0 when rounding disabled. */
  roundOff: Decimal;
  /** Final payable (rounded to rupee when enabled), rupees. */
  grandTotal: Decimal;
  /** CGST_SGST (intra-state) | IGST (inter-state) — for display/print. */
  taxKind: "CGST_SGST" | "IGST";
}

const ZERO = new Decimal(0);

/**
 * Resolve the taxable value of one line: gross = unitPrice × qty, subtract discount,
 * then (if the price is MRP-inclusive) back-calculate the tax-exclusive taxable from
 * the discounted amount. Discount is ALWAYS applied before tax (03 §8). Never
 * negative — a discount larger than the gross clamps the taxable to 0.
 */
export function lineTaxable(line: LineInput, extraDiscount: Decimal.Value = 0): {
  gross: Decimal;
  discount: Decimal;
  taxable: Decimal;
} {
  const gross = new Decimal(line.unitPrice).times(line.qty);
  const discount = new Decimal(line.lineDiscount ?? 0).plus(extraDiscount);
  const netAfterDiscount = Decimal.max(gross.minus(discount), ZERO);
  const taxable = line.priceInclusive
    ? backCalcTaxable(netAfterDiscount, line.gstRatePct)
    : netAfterDiscount;
  return { gross, discount, taxable };
}

/**
 * Compute the full pakka invoice (03 §8). `billDiscount` is spread across lines in
 * proportion to each line's gross value so the discount-before-tax rule holds at the
 * line level (and so per-line taxable values, which are persisted and reported, are
 * correct). Place of supply vs home state drives CGST/SGST vs IGST. When `roundOff`
 * is true the grand total is rounded to the nearest rupee with a single round_off
 * delta (per-invoice rounding — 03 §8, A3).
 */
export function computeInvoiceTotals(opts: {
  lines: LineInput[];
  supplyState: string;
  homeState: string;
  billDiscount?: Decimal.Value;
  roundOff?: boolean;
}): InvoiceTotals {
  const { lines, supplyState, homeState } = opts;
  const billDiscount = new Decimal(opts.billDiscount ?? 0);
  const roundOff = opts.roundOff ?? true;
  const taxKind = supplyState === homeState ? "CGST_SGST" : "IGST";

  // Bill discount is apportioned by gross value. Compute grosses once.
  const grosses = lines.map((l) => new Decimal(l.unitPrice).times(l.qty));
  const grossSum = grosses.reduce((a, b) => a.plus(b), ZERO);

  const computed: ComputedLine[] = [];
  let allocatedBillDiscount = ZERO;

  lines.forEach((line, i) => {
    // Apportion the bill discount; give the last line the rounding remainder so the
    // apportioned shares sum EXACTLY to billDiscount (no penny lost to rounding).
    let share: Decimal;
    if (grossSum.isZero() || billDiscount.isZero()) {
      share = ZERO;
    } else if (i === lines.length - 1) {
      share = billDiscount.minus(allocatedBillDiscount);
    } else {
      share = billDiscount.times(grosses[i]!).div(grossSum).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      allocatedBillDiscount = allocatedBillDiscount.plus(share);
    }

    const { gross, discount, taxable } = lineTaxable(line, share);
    const tax = computeLineTax(taxable, line.gstRatePct, supplyState, homeState);
    const lineTotal = taxable.plus(tax.cgst).plus(tax.sgst).plus(tax.igst);

    computed.push({
      gross,
      discount,
      taxableValue: taxable,
      gstRatePct: new Decimal(line.gstRatePct),
      cgst: tax.cgst,
      sgst: tax.sgst,
      igst: tax.igst,
      lineTotal,
    });
  });

  const sum = (pick: (l: ComputedLine) => Decimal) => computed.reduce((a, l) => a.plus(pick(l)), ZERO);
  const taxableTotal = sum((l) => l.taxableValue);
  const discountTotal = sum((l) => l.discount);
  const cgstTotal = sum((l) => l.cgst);
  const sgstTotal = sum((l) => l.sgst);
  const igstTotal = sum((l) => l.igst);
  const preRoundTotal = taxableTotal.plus(cgstTotal).plus(sgstTotal).plus(igstTotal);

  const grandTotal = roundOff ? roundToRupee(preRoundTotal) : preRoundTotal;
  const roundOffDelta = grandTotal.minus(preRoundTotal);

  return {
    lines: computed,
    taxableTotal,
    discountTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    preRoundTotal,
    roundOff: roundOffDelta,
    grandTotal,
    taxKind,
  };
}
