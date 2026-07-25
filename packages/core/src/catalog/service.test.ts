import { describe, it, expect } from "vitest";
import { validateQtyToBase } from "./service";
import { FractionalPieceError } from "../shared/errors";
import { createProductSchema, importRowSchema } from "./schema";

// Catalog UoM-conversion (Chunk 6 acceptance: "toBaseQty drives every qty; PIECE
// rejects fractions"). validateQtyToBase is the one rule catalog/import/billing
// reuse — it wraps the tested uom.toBaseQty and returns a 3dp Prisma Decimal.

describe("catalog.validateQtyToBase — UoM conversion drives qty", () => {
  it("converts a sale qty to base via factorToBase (2 coils × 90 = 180 m)", () => {
    const base = validateQtyToBase("2", { code: "coil", kind: "MEASURED", factorToBase: "90" });
    expect(base.toString()).toBe("180");
  });

  it("allows decimal quantities for MEASURED units (2.5 kg × 1 = 2.5)", () => {
    const base = validateQtyToBase("2.5", { code: "kg", kind: "MEASURED", factorToBase: "1" });
    expect(base.toString()).toBe("2.5");
  });

  it("rejects a fractional quantity for a PIECE unit", () => {
    expect(() =>
      validateQtyToBase("1.5", { code: "pc", kind: "PIECE", factorToBase: "1" }),
    ).toThrow(FractionalPieceError);
  });

  it("accepts a whole quantity for a PIECE unit (3 boxes × 12 = 36)", () => {
    const base = validateQtyToBase("3", { code: "box", kind: "PIECE", factorToBase: "12" });
    expect(base.toString()).toBe("36");
  });
});

describe("catalog.createProductSchema — input contract", () => {
  it("accepts a valid product with base + 2 sale units", () => {
    const parsed = createProductSchema.safeParse({
      sku: "FNX-WIRE-2.5",
      name: "Finolex 2.5 sq mm FR Wire",
      categoryId: "cat_electrical",
      hsnCode: "8544",
      gstRatePct: "18",
      baseUnitId: "u_mtr",
      saleUnits: [
        { unitId: "u_mtr", factorToBase: "1", salePrice: 4200 },
        { unitId: "u_coil", factorToBase: "90", salePrice: 351000, mrp: 360000 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a product with no sale units", () => {
    const parsed = createProductSchema.safeParse({
      sku: "X",
      name: "X",
      categoryId: "c",
      gstRatePct: "18",
      baseUnitId: "u",
      saleUnits: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-positive conversion factor", () => {
    const parsed = createProductSchema.safeParse({
      sku: "X",
      name: "X",
      categoryId: "c",
      gstRatePct: "18",
      baseUnitId: "u",
      saleUnits: [{ unitId: "u", factorToBase: "0", salePrice: 100 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a fractional (non-integer) price in paise", () => {
    const parsed = createProductSchema.safeParse({
      sku: "X",
      name: "X",
      categoryId: "c",
      gstRatePct: "18",
      baseUnitId: "u",
      saleUnits: [{ unitId: "u", factorToBase: "1", salePrice: 100.5 }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("catalog.importRowSchema — CSV row contract", () => {
  it("accepts a complete row with opening stock", () => {
    const parsed = importRowSchema.safeParse({
      sku: "CEM-OPC-50",
      name: "OPC Cement 50kg",
      category: "Cement",
      gstRatePct: "28",
      baseUnitCode: "bag",
      saleUnitCode: "bag",
      factorToBase: "1",
      salePrice: 38000,
      openingStock: "100",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a row missing the required sku", () => {
    const parsed = importRowSchema.safeParse({
      name: "x",
      category: "c",
      gstRatePct: "18",
      baseUnitCode: "pc",
      saleUnitCode: "pc",
      factorToBase: "1",
      salePrice: 100,
    });
    expect(parsed.success).toBe(false);
  });
});
