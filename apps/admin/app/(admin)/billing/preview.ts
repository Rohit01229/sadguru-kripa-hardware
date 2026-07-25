// Client-side LIVE TOTAL preview for the POS (paise integer math). This is a UI
// convenience ONLY — the core service (computeInvoiceTotals, 03 §8) is authoritative
// and re-derives every figure server-side. We mirror its rules here (discount-before-
// tax, MRP-inclusive back-calc, place-of-supply split, per-invoice round-off) so the
// cashier sees an accurate running total before submitting. All amounts are integer
// paise; rupee rounding uses round-half-up to match money.roundToRupee.

export interface PreviewLine {
  unitPricePaise: number;
  qty: number;
  gstRatePct: number;
  lineDiscountPaise: number;
  priceInclusive: boolean;
}

export interface PreviewTotals {
  taxableTotal: number;
  discountTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  roundOff: number;
  grandTotal: number;
  taxKind: "CGST_SGST" | "IGST";
}

/** Format integer paise as a rupee string with 2 decimals. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function roundToRupeePaise(paise: number): number {
  // round-half-up to the nearest rupee (100 paise).
  return Math.round(paise / 100) * 100;
}

export function previewTotals(opts: {
  lines: PreviewLine[];
  supplyState: string;
  homeState: string;
  billDiscountPaise: number;
  roundOff: boolean;
  /** When false (kacha) no tax is computed/shown — taxable == net, no GST. */
  taxed: boolean;
}): PreviewTotals {
  const { lines, supplyState, homeState, billDiscountPaise, roundOff, taxed } = opts;
  const intra = supplyState === homeState;
  const taxKind: "CGST_SGST" | "IGST" = intra ? "CGST_SGST" : "IGST";

  const grosses = lines.map((l) => Math.round(l.unitPricePaise * l.qty));
  const grossSum = grosses.reduce((a, b) => a + b, 0);

  let taxableTotal = 0;
  let discountTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let allocated = 0;

  lines.forEach((l, i) => {
    let share = 0;
    if (grossSum > 0 && billDiscountPaise > 0) {
      share =
        i === lines.length - 1
          ? billDiscountPaise - allocated
          : Math.round((billDiscountPaise * grosses[i]!) / grossSum);
      if (i !== lines.length - 1) allocated += share;
    }
    const discount = l.lineDiscountPaise + share;
    const net = Math.max(grosses[i]! - discount, 0);
    const taxable = taxed && l.priceInclusive ? Math.round((net * 100) / (100 + l.gstRatePct)) : net;
    discountTotal += discount;
    taxableTotal += taxable;
    if (taxed) {
      const tax = Math.round((taxable * l.gstRatePct) / 100);
      if (intra) {
        const half = Math.round(tax / 2);
        cgstTotal += half;
        sgstTotal += tax - half;
      } else {
        igstTotal += tax;
      }
    }
  });

  const preRound = taxableTotal + cgstTotal + sgstTotal + igstTotal;
  const grandTotal = taxed && roundOff ? roundToRupeePaise(preRound) : preRound;
  const roundOffDelta = grandTotal - preRound;

  return {
    taxableTotal,
    discountTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    roundOff: roundOffDelta,
    grandTotal,
    taxKind,
  };
}
