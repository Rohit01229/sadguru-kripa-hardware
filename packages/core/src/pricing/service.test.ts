import { describe, it, expect } from "vitest";
import { Prisma } from "../shared/db";
import { pickSlabPrice } from "./service";

// Slab resolution (03 §4, Chunk 6 acceptance: "slabs resolve correctly for
// (product, saleUnit, qty)"). Unit-tests the PURE pick logic that resolvePrice
// runs as an indexed query: greatest minQty ≤ qty wins, else the default price.
// Visible to all (storefront + counter) — no role branching here.

const D = (v: string | number) => new Prisma.Decimal(v);

describe("pricing.pickSlabPrice — quantity-break resolution", () => {
  const slabs = [
    { minQty: D(10), pricePerSaleUnit: D(4000) }, // ≥10 → 40.00
    { minQty: D(50), pricePerSaleUnit: D(3500) }, // ≥50 → 35.00
    { minQty: D(100), pricePerSaleUnit: D(3000) }, // ≥100 → 30.00
  ];
  const defaultPrice = D(4200); // 42.00

  it("falls back to the default price below the lowest slab", () => {
    const r = pickSlabPrice(defaultPrice, slabs, "5");
    expect(r.unitPrice.toString()).toBe("4200");
    expect(r.matchedSlabMinQty).toBeNull();
  });

  it("picks the first slab exactly at its minQty (≥10)", () => {
    const r = pickSlabPrice(defaultPrice, slabs, "10");
    expect(r.unitPrice.toString()).toBe("4000");
    expect(r.matchedSlabMinQty).toBe("10");
  });

  it("picks the greatest minQty ≤ qty (qty 75 → the 50 slab, not 10)", () => {
    const r = pickSlabPrice(defaultPrice, slabs, "75");
    expect(r.unitPrice.toString()).toBe("3500");
    expect(r.matchedSlabMinQty).toBe("50");
  });

  it("picks the top slab when qty exceeds the highest minQty", () => {
    const r = pickSlabPrice(defaultPrice, slabs, "250");
    expect(r.unitPrice.toString()).toBe("3000");
    expect(r.matchedSlabMinQty).toBe("100");
  });

  it("handles decimal quantities for MEASURED units", () => {
    const r = pickSlabPrice(defaultPrice, slabs, "49.999");
    expect(r.matchedSlabMinQty).toBe("10"); // just below 50
  });

  it("returns the default when there are no slabs", () => {
    const r = pickSlabPrice(defaultPrice, [], "1000");
    expect(r.unitPrice.toString()).toBe("4200");
    expect(r.matchedSlabMinQty).toBeNull();
  });

  it("is independent of slab input order", () => {
    const shuffled = [slabs[2]!, slabs[0]!, slabs[1]!];
    const r = pickSlabPrice(defaultPrice, shuffled, "60");
    expect(r.matchedSlabMinQty).toBe("50");
  });
});
