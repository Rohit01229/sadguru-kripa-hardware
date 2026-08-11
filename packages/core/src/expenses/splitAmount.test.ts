import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { splitAmount } from "./service";

// The expense form asks for the GROSS — what left the till — and derives the taxable
// value from it. The invariant that matters is that the parts always sum back to the
// whole: a shopkeeper's total must never move because we split it.

const sum = (s: ReturnType<typeof splitAmount>) =>
  s.taxable.plus(s.cgst).plus(s.sgst).plus(s.igst);

describe("splitAmount", () => {
  it("leaves the whole amount taxable when there is no GST", () => {
    const s = splitAmount(150000, 0, false);
    expect(s.taxable.toFixed(2)).toBe("1500.00");
    expect(s.cgst.toNumber()).toBe(0);
    expect(s.sgst.toNumber()).toBe(0);
    expect(s.igst.toNumber()).toBe(0);
  });

  it("back-calculates the taxable value from a GST-inclusive total", () => {
    // ₹1,180 at 18% is ₹1,000 + ₹180.
    const s = splitAmount(118000, 18, false);
    expect(s.taxable.toFixed(2)).toBe("1000.00");
    expect(s.cgst.toFixed(2)).toBe("90.00");
    expect(s.sgst.toFixed(2)).toBe("90.00");
    expect(s.igst.toNumber()).toBe(0);
  });

  it("puts the whole tax in IGST for an out-of-state supplier", () => {
    const s = splitAmount(118000, 18, true);
    expect(s.taxable.toFixed(2)).toBe("1000.00");
    expect(s.igst.toFixed(2)).toBe("180.00");
    expect(s.cgst.toNumber()).toBe(0);
    expect(s.sgst.toNumber()).toBe(0);
  });

  it("never loses a paisa, at any rate or amount", () => {
    // An odd tax that cannot halve evenly is exactly where a rounding bug hides.
    for (const total of [1, 99, 100, 12345, 118000, 100001, 999999]) {
      for (const rate of [0, 5, 12, 18, 28]) {
        for (const inter of [false, true]) {
          const s = splitAmount(total, rate, inter);
          expect(sum(s).toFixed(2)).toBe(new Decimal(total).div(100).toFixed(2));
        }
      }
    }
  });

  it("splits an odd tax so the two halves still sum exactly", () => {
    // ₹100.03 at 5% → tax of ₹4.77, which does not halve evenly.
    const s = splitAmount(10003, 5, false);
    expect(s.cgst.plus(s.sgst).toFixed(2)).toBe(
      new Decimal(10003).div(100).minus(s.taxable).toFixed(2),
    );
    expect(s.cgst.equals(s.sgst) || s.sgst.minus(s.cgst).abs().lte("0.01")).toBe(true);
  });
});
