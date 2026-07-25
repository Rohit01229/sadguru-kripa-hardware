import { describe, it, expect } from "vitest";
import { toBaseQty } from "./uom";
import { FractionalPieceError } from "./errors";

describe("uom.toBaseQty", () => {
  it("converts coils to base metres (2 × 90 = 180)", () => {
    expect(toBaseQty(2, { code: "coil", kind: "MEASURED", factorToBase: 90 }).toString()).toBe("180");
  });
  it("allows decimals for measured units", () => {
    expect(toBaseQty("2.5", { code: "kg", kind: "MEASURED", factorToBase: 1 }).toString()).toBe("2.5");
  });
  it("rejects fractional pieces", () => {
    expect(() => toBaseQty("1.5", { code: "pc", kind: "PIECE", factorToBase: 1 })).toThrow(
      FractionalPieceError,
    );
  });
});
