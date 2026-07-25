import { describe, it, expect } from "vitest";
import { computeLineTax, backCalcTaxable } from "./tax";

describe("tax.computeLineTax", () => {
  it("splits CGST + SGST for an intra-state supply", () => {
    const t = computeLineTax(1000, 18, "MH", "MH");
    expect(t.cgst.toString()).toBe("90");
    expect(t.sgst.toString()).toBe("90");
    expect(t.igst.toString()).toBe("0");
  });
  it("uses IGST for an inter-state supply", () => {
    const t = computeLineTax(1000, 18, "GJ", "MH");
    expect(t.igst.toString()).toBe("180");
    expect(t.cgst.toString()).toBe("0");
    expect(t.sgst.toString()).toBe("0");
  });
});

describe("tax.backCalcTaxable", () => {
  it("derives taxable value from an MRP-inclusive price", () => {
    expect(backCalcTaxable(118, 18).toString()).toBe("100");
  });
});
