import { describe, it, expect } from "vitest";
import { validateQtyToBase, skuPrefix } from "./service";
import { FractionalPieceError } from "../shared/errors";
import { createProductSchema, importRowSchema } from "./schema";
import { DEFAULT_UNITS, DEFAULT_UNIT_CODE, DEFAULT_CATEGORY_NAME } from "./defaults";

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

  it("accepts SIMPLE mode — name + salePrice + gst, no sku/category/unit/saleUnits", () => {
    const parsed = createProductSchema.safeParse({
      name: "UltraTech PPC Cement",
      gstRatePct: "28",
      salePrice: 42000,
    });
    expect(parsed.success).toBe(true);
    // The server fills these in; Zod must not demand them.
    expect(parsed.success && parsed.data.sku).toBeUndefined();
    expect(parsed.success && parsed.data.categoryId).toBeUndefined();
    expect(parsed.success && parsed.data.baseUnitId).toBeUndefined();
    expect(parsed.success && parsed.data.saleUnits).toEqual([]);
  });

  it("accepts opening stock, barcode and a wholesale slab on the simple path", () => {
    const parsed = createProductSchema.safeParse({
      name: "Binding Wire",
      gstRatePct: "18",
      salePrice: 8500,
      openingStock: "25.5",
      barcode: "8901234567890",
      wholesalePrice: 7900,
      wholesaleMinQty: "10",
    });
    expect(parsed.success).toBe(true);
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

describe("catalog.skuPrefix — auto-generated item codes", () => {
  it("strips non-alphanumerics, upper-cases, and caps at 6 chars", () => {
    expect(skuPrefix("UltraTech PPC Cement")).toBe("ULTRAT");
    expect(skuPrefix("2.5 sq mm wire")).toBe("25SQMM");
  });

  it("keeps short names as-is", () => {
    expect(skuPrefix("Nail")).toBe("NAIL");
  });

  it("falls back to ITEM when the name has nothing usable", () => {
    expect(skuPrefix("सीमेंट")).toBe("ITEM");
    expect(skuPrefix("--- ---")).toBe("ITEM");
  });
});

describe("catalog.defaults — starter masters", () => {
  it("ships a hardware-store unit set led by the default PCS unit", () => {
    expect(DEFAULT_UNITS.some((u) => u.code === DEFAULT_UNIT_CODE)).toBe(true);
    expect(DEFAULT_CATEGORY_NAME).toBe("General");
  });

  it("has unique codes and only MEASURED/PIECE kinds", () => {
    const codes = DEFAULT_UNITS.map((u) => u.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(DEFAULT_UNITS.every((u) => u.kind === "MEASURED" || u.kind === "PIECE")).toBe(true);
  });

  it("keeps countable units PIECE so fractional quantities are rejected", () => {
    // PCS/BOX/BAG are counted, so uom.toBaseQty must refuse "1.5 of them".
    for (const code of ["PCS", "BOX", "BAG", "DOZ"]) {
      expect(DEFAULT_UNITS.find((u) => u.code === code)?.kind).toBe("PIECE");
    }
    expect(() => validateQtyToBase("1.5", { code: "PCS", kind: "PIECE", factorToBase: "1" })).toThrow(
      FractionalPieceError,
    );
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
      salePrice: "380", // rupees in the sheet (19 §9)
      openingStock: "100",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.salePrice).toBe(38000);
  });

  // Item Code used to be mandatory, which meant a shopkeeper had to invent a unique
  // code for every row before they could import anything. It is now optional and the
  // service generates one — the same rule as the quick "New Item" form (19 §2, §9).
  it("accepts a row with no item code and fills it in later", () => {
    const parsed = importRowSchema.safeParse({
      name: "x",
      category: "c",
      gstRatePct: "18",
      baseUnitCode: "pc",
      saleUnitCode: "pc",
      factorToBase: "1",
      salePrice: "1",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sku).toBeUndefined();
  });

  it("still rejects a row with no name", () => {
    expect(importRowSchema.safeParse({ salePrice: "100" }).success).toBe(false);
  });
});
