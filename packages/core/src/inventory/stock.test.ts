import { describe, it, expect } from "vitest";
import {
  grnLineBaseAndCost,
  negativeAllowed,
  isLowStock,
} from "./service";
import { FractionalPieceError } from "../shared/errors";

// S3 (Inventory / Stock) unit tests. These cover the PURE, DB-free logic the slice
// is graded on — GRN receive-unit→base conversion + cost, the negative-stock
// policy decision, and the low-stock flag. The atomic increment/decrement against
// real Postgres (no oversell under concurrency) is the kernel's S8 integration
// concern (14-impl-plan Chunk 12); the kernel's signed-movement behaviour is
// already asserted in service.test.ts.

describe("inventory.grnLineBaseAndCost — receive-unit → base conversion", () => {
  it("converts 5 coils (factor 90) → 450 base metres", () => {
    const { baseQty } = grnLineBaseAndCost(
      "5",
      { code: "coil", kind: "MEASURED", factorToBase: "90" },
      288000, // ₹2880 per coil (paise)
    );
    expect(baseQty.toString()).toBe("450");
  });

  it("derives per-base cost = costPerReceiveUnit / factor", () => {
    // ₹2880/coil ÷ 90 m/coil = ₹32.00/m
    const { costPerBase } = grnLineBaseAndCost(
      "5",
      { code: "coil", kind: "MEASURED", factorToBase: "90" },
      288000,
    );
    expect(costPerBase.toFixed(2)).toBe("32.00");
  });

  it("handles a factor-1 base receive (qty unchanged, cost unchanged)", () => {
    const { baseQty, costPerBase } = grnLineBaseAndCost(
      "12",
      { code: "m", kind: "MEASURED", factorToBase: "1" },
      4200,
    );
    expect(baseQty.toString()).toBe("12");
    expect(costPerBase.toFixed(2)).toBe("42.00");
  });

  it("allows fractional MEASURED quantities", () => {
    const { baseQty } = grnLineBaseAndCost(
      "2.5",
      { code: "kg", kind: "MEASURED", factorToBase: "1" },
      0,
    );
    expect(baseQty.toString()).toBe("2.5");
  });

  it("rejects a fractional PIECE receive quantity", () => {
    expect(() =>
      grnLineBaseAndCost("1.5", { code: "pc", kind: "PIECE", factorToBase: "1" }, 0),
    ).toThrow(FractionalPieceError);
  });
});

describe("inventory.negativeAllowed — negative-stock policy (03 §5, A5)", () => {
  it("blocks an OUT by default (neither product nor request opts in)", () => {
    expect(negativeAllowed(false, false)).toBe(false);
  });
  it("allows when the product is flagged allowNegative", () => {
    expect(negativeAllowed(true, false)).toBe(true);
  });
  it("allows when the request opts in (e.g. damaged-goods adjustment)", () => {
    expect(negativeAllowed(false, true)).toBe(true);
  });
});

describe("inventory.isLowStock — reorder-level flag", () => {
  it("flags when onHand is at or below the reorder level", () => {
    expect(isLowStock("5", "10")).toBe(true);
    expect(isLowStock("10", "10")).toBe(true); // boundary: ≤
  });
  it("does not flag when onHand is above the reorder level", () => {
    expect(isLowStock("11", "10")).toBe(false);
  });
  it("never flags when no reorder level is set", () => {
    expect(isLowStock("0", null)).toBe(false);
  });
});
