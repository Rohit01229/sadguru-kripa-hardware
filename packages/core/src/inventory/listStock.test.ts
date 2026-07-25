import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// Regression: the `lowStockOnly` filter alias must actually engage the low-stock
// filter (it was computed into `onlyLow` but the function body still keyed off the
// legacy `lowOnly`, so `lowStockOnly:true` alone was silently ignored). These tests
// assert BOTH the legacy flag and the new alias prune to items at/below reorder level,
// and that the unfiltered call returns everything. Only the db layer is mocked.

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  reorderLevel: unknown | null;
  allowNegative: boolean;
  baseUnit: { code: string };
  stock: { onHand: unknown; reserved: unknown } | null;
}

let products: ProductRow[] = [];

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = actual.default;
  return {
    prisma: { product: { findMany: vi.fn(async () => products) } },
    Prisma: { Decimal: PrismaDecimal },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn({}),
  };
});

import { listStock } from "./service";
import { Prisma } from "../shared/db";

const D = (v: string) => new Prisma.Decimal(v);

function product(id: string, onHand: string, reorderLevel: string | null): ProductRow {
  return {
    id,
    sku: id.toUpperCase(),
    name: id,
    reorderLevel: reorderLevel === null ? null : D(reorderLevel),
    allowNegative: false,
    baseUnit: { code: "pc" },
    stock: { onHand: D(onHand), reserved: D("0") },
  };
}

describe("inventory.listStock — low-stock filter (lowOnly + lowStockOnly alias)", () => {
  beforeEach(() => {
    products = [
      product("low", "2", "5"), // onHand 2 ≤ reorder 5 → low
      product("ok", "50", "5"), // onHand 50 > reorder 5 → not low
      product("nolevel", "0", null), // no reorder level → never low
    ];
  });

  it("returns ALL active products when no low-stock flag is set", async () => {
    const page = await listStock({});
    expect(page.data.map((r) => r.productId).sort()).toEqual(["low", "nolevel", "ok"]);
  });

  it("legacy lowOnly:true keeps only items at/below reorder level", async () => {
    const page = await listStock({ lowOnly: true });
    expect(page.data.map((r) => r.productId)).toEqual(["low"]);
  });

  it("lowStockOnly:true alias engages the same filter (regression)", async () => {
    const page = await listStock({ lowStockOnly: true });
    expect(page.data.map((r) => r.productId)).toEqual(["low"]);
  });
});
