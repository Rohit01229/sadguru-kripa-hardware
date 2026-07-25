import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeInvoiceTotals, lineTaxable } from "./totals";

// S4 pakka-invoice arithmetic (03 §8). PURE, DB-free — the load-bearing money/tax
// math the slice is graded on: tax split intra/inter-state, discount-before-tax,
// MRP-inclusive back-calc, manual override, and per-invoice round-off.

describe("billing.computeInvoiceTotals — place-of-supply tax split (03 §8)", () => {
  it("intra-state → CGST + SGST (each = rate/2), no IGST", () => {
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 1000, qty: 1, gstRatePct: 18 }],
      supplyState: "19",
      homeState: "19",
    });
    expect(t.taxKind).toBe("CGST_SGST");
    expect(t.taxableTotal.toString()).toBe("1000");
    expect(t.cgstTotal.toString()).toBe("90");
    expect(t.sgstTotal.toString()).toBe("90");
    expect(t.igstTotal.toString()).toBe("0");
    expect(t.preRoundTotal.toString()).toBe("1180");
    expect(t.grandTotal.toString()).toBe("1180");
  });

  it("inter-state → IGST (full rate), no CGST/SGST", () => {
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 1000, qty: 1, gstRatePct: 18 }],
      supplyState: "27",
      homeState: "19",
    });
    expect(t.taxKind).toBe("IGST");
    expect(t.igstTotal.toString()).toBe("180");
    expect(t.cgstTotal.toString()).toBe("0");
    expect(t.sgstTotal.toString()).toBe("0");
    expect(t.grandTotal.toString()).toBe("1180");
  });
});

describe("billing.computeInvoiceTotals — discount before tax (03 §8)", () => {
  it("line discount reduces the taxable value, then tax is on the net", () => {
    // gross 1000, −200 line discount → taxable 800 → 18% = 144
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 1000, qty: 1, gstRatePct: 18, lineDiscount: 200 }],
      supplyState: "19",
      homeState: "19",
    });
    expect(t.discountTotal.toString()).toBe("200");
    expect(t.taxableTotal.toString()).toBe("800");
    expect(t.cgstTotal.toString()).toBe("72");
    expect(t.sgstTotal.toString()).toBe("72");
    expect(t.grandTotal.toString()).toBe("944");
  });

  it("a discount larger than the gross clamps the taxable to 0 (never negative)", () => {
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 100, qty: 1, gstRatePct: 18, lineDiscount: 500 }],
      supplyState: "19",
      homeState: "19",
    });
    expect(t.taxableTotal.toString()).toBe("0");
    expect(t.grandTotal.toString()).toBe("0");
  });

  it("bill discount is apportioned across lines by gross, before tax", () => {
    // Two lines, gross 600 and 400 (sum 1000). Bill discount 100 → 60 / 40 split.
    const t = computeInvoiceTotals({
      lines: [
        { unitPrice: 600, qty: 1, gstRatePct: 18 },
        { unitPrice: 400, qty: 1, gstRatePct: 18 },
      ],
      supplyState: "19",
      homeState: "19",
      billDiscount: 100,
    });
    expect(t.lines[0]!.discount.toString()).toBe("60");
    expect(t.lines[1]!.discount.toString()).toBe("40");
    expect(t.discountTotal.toString()).toBe("100");
    expect(t.taxableTotal.toString()).toBe("900"); // 540 + 360
  });

  it("apportioned bill discount sums EXACTLY to the bill discount (remainder to last line)", () => {
    // 3 equal lines, bill discount 100 → 33.33/33.33/33.34 (last line takes the remainder).
    const t = computeInvoiceTotals({
      lines: [
        { unitPrice: 100, qty: 1, gstRatePct: 18 },
        { unitPrice: 100, qty: 1, gstRatePct: 18 },
        { unitPrice: 100, qty: 1, gstRatePct: 18 },
      ],
      supplyState: "19",
      homeState: "19",
      billDiscount: 100,
    });
    const sum = t.lines.reduce((a, l) => a.plus(l.discount), new Decimal(0));
    expect(sum.toString()).toBe("100");
    expect(t.discountTotal.toString()).toBe("100");
  });
});

describe("billing.computeInvoiceTotals — MRP-inclusive back-calc (03 §8)", () => {
  it("back-calculates the taxable from an inclusive price (118 incl @18% → 100 taxable)", () => {
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 118, qty: 1, gstRatePct: 18, priceInclusive: true }],
      supplyState: "19",
      homeState: "19",
    });
    expect(t.taxableTotal.toString()).toBe("100");
    expect(t.cgstTotal.toString()).toBe("9");
    expect(t.sgstTotal.toString()).toBe("9");
    // Grand total honours the displayed MRP.
    expect(t.grandTotal.toString()).toBe("118");
  });

  it("applies discount to the inclusive price BEFORE back-calc", () => {
    // 118 incl − 18 discount = 100 net incl → taxable = 100×100/118 ≈ 84.75
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 118, qty: 1, gstRatePct: 18, priceInclusive: true, lineDiscount: 18 }],
      supplyState: "19",
      homeState: "19",
    });
    expect(t.taxableTotal.toFixed(2)).toBe("84.75");
    expect(t.grandTotal.toString()).toBe("100");
  });
});

describe("billing.computeInvoiceTotals — manual rate override", () => {
  it("uses the supplied unitPrice verbatim as the taxable basis", () => {
    // Catalog would price one bag at, say, ₹380; override to ₹365 → taxable 365×10=3650.
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 365, qty: 10, gstRatePct: 28 }],
      supplyState: "19",
      homeState: "19",
    });
    expect(t.taxableTotal.toString()).toBe("3650");
    expect(t.cgstTotal.toString()).toBe("511"); // 3650×28/2/100
    expect(t.sgstTotal.toString()).toBe("511");
  });
});

describe("billing.computeInvoiceTotals — per-invoice round-off (03 §8)", () => {
  it("rounds the grand total to the nearest rupee with a signed round_off delta", () => {
    // taxable 100.20 @18% = 18.036 tax → 118.236 → rounds DOWN to 118, round_off −0.236
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 100.2, qty: 1, gstRatePct: 18 }],
      supplyState: "19",
      homeState: "19",
      roundOff: true,
    });
    expect(t.preRoundTotal.toFixed(3)).toBe("118.236");
    expect(t.grandTotal.toString()).toBe("118");
    expect(t.roundOff.toFixed(3)).toBe("-0.236");
  });

  it("rounds UP and yields a positive round_off when the fraction is ≥ .5", () => {
    // taxable 100.60 @18% = 18.108 → 118.708 → rounds UP to 119, round_off +0.292
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 100.6, qty: 1, gstRatePct: 18 }],
      supplyState: "19",
      homeState: "19",
      roundOff: true,
    });
    expect(t.grandTotal.toString()).toBe("119");
    expect(t.roundOff.toFixed(3)).toBe("0.292");
  });

  it("leaves the total unrounded with zero round_off when rounding is disabled", () => {
    const t = computeInvoiceTotals({
      lines: [{ unitPrice: 100.2, qty: 1, gstRatePct: 18 }],
      supplyState: "19",
      homeState: "19",
      roundOff: false,
    });
    expect(t.grandTotal.toFixed(3)).toBe("118.236");
    expect(t.roundOff.toString()).toBe("0");
  });
});

describe("billing.lineTaxable — single-line helper", () => {
  it("computes gross, discount, and a clamped taxable", () => {
    const r = lineTaxable({ unitPrice: 50, qty: 3, gstRatePct: 18, lineDiscount: 10 });
    expect(r.gross.toString()).toBe("150");
    expect(r.discount.toString()).toBe("10");
    expect(r.taxable.toString()).toBe("140");
  });
});
