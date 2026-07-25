import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// S4 kacha ZERO-TRACE unit test (03 §6, 13 §8). Asserts finalizeKacha persists
// EXACTLY ONE StockMovement{kind: KACHA_OUT} per line and NOTHING else — the mock
// Tx records every table touched, and we assert invoice / invoiceLine / payment /
// ledgerEntry / creditNote were NEVER written. The real atomic-decrement guarantee
// is the kernel's concern (covered by the live-DB smoke); here we prove the
// zero-trace footprint at the service level.
//
// Decimal.js is real; only the db layer is mocked so we exercise the actual
// finalizeKacha control flow (loadLineCatalog → toBase → decrementStock → audit).

const tableCalls: Record<string, string[]> = {};
function record(table: string, op: string) {
  (tableCalls[table] ??= []).push(op);
}

// A mock Tx that records which model.method was invoked. decrementStock issues a
// $executeRaw (returns 1 row affected = success) then stockMovement.create.
function makeTx() {
  let mvSeq = 0;
  return {
    productSaleUnit: {
      findFirst: vi.fn(async () => ({
        id: "su_1",
        factorToBase: { toString: () => "90" },
        salePrice: { toString: () => "0" },
        unit: { code: "coil", kind: "MEASURED" },
        product: { id: "prod_1", gstRate: { toString: () => "18" }, priceInclusive: false, hsnCode: "7217" },
      })),
    },
    stockMovement: {
      create: vi.fn(async () => {
        record("stockMovement", "create");
        mvSeq += 1;
        return { id: `mv_${mvSeq}` };
      }),
    },
    invoice: { create: vi.fn(async () => { record("invoice", "create"); return { id: "x" }; }) },
    invoiceLine: { create: vi.fn(async () => { record("invoiceLine", "create"); return { id: "x" }; }) },
    payment: { create: vi.fn(async () => { record("payment", "create"); return { id: "x" }; }) },
    ledgerEntry: { create: vi.fn(async () => { record("ledgerEntry", "create"); return { id: "x" }; }) },
    creditNote: { create: vi.fn(async () => { record("creditNote", "create"); return { id: "x" }; }) },
    invoiceCounter: { upsert: vi.fn(async () => ({})) },
    auditLog: {
      create: vi.fn(async () => {
        record("auditLog", "create");
        return { id: "audit_1" };
      }),
    },
    $executeRaw: vi.fn(async () => {
      record("$executeRaw", "decrement");
      return 1; // 1 row affected → decrement succeeded
    }),
    $queryRaw: vi.fn(async () => [{ lastNo: 1 }]),
  };
}

const tx = makeTx();

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = actual.default;
  return {
    prisma: {},
    Prisma: { Decimal: PrismaDecimal },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

import { finalizeKacha } from "./service";

const ctx = {
  session: {
    userId: "owner_1",
    realm: "STAFF" as const,
    roles: ["OWNER"],
    permissions: ["bill.kacha.create"],
  },
  requestId: "req_1",
};

/** Last `{ data }` argument a recorded create() received (typed loosely for assertions). */
function lastCreateData(fn: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const calls = fn.mock.calls;
  const last = calls[calls.length - 1] as unknown[] | undefined;
  return (last?.[0] as { data: Record<string, unknown> }).data;
}

describe("billing.finalizeKacha — ZERO TRACE (03 §6, 13 §8)", () => {
  beforeEach(() => {
    for (const k of Object.keys(tableCalls)) delete tableCalls[k];
  });

  it("writes EXACTLY ONE KACHA_OUT movement per line and NOTHING else", async () => {
    const result = await finalizeKacha(
      { lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "2" }] },
      ctx,
    );

    // One movement, one decrement, one audit — and NO bill/value/ledger rows.
    expect(tableCalls.stockMovement).toEqual(["create"]);
    expect(tableCalls.$executeRaw).toEqual(["decrement"]);
    expect(tableCalls.invoice).toBeUndefined();
    expect(tableCalls.invoiceLine).toBeUndefined();
    expect(tableCalls.payment).toBeUndefined();
    expect(tableCalls.ledgerEntry).toBeUndefined();
    expect(tableCalls.creditNote).toBeUndefined();

    // The KACHA_OUT movement is tagged correctly and unattributed (no refType/refId/customer).
    const mv = lastCreateData(tx.stockMovement.create);
    expect(mv.kind).toBe("KACHA_OUT");
    expect(mv.refType).toBeNull();
    expect(mv.refId).toBeNull();
    expect(mv.actorStaffId).toBe("owner_1"); // actor is the only attribution kept

    // The estimate is ephemeral: NO invoice number, NO persisted bill id.
    expect(result.type).toBe("KACHA_ESTIMATE");
    expect(result).not.toHaveProperty("invoiceNo");
    expect(result).not.toHaveProperty("id");
    expect(result.stockMovementRefs).toEqual(["mv_1"]);
  });

  it("converts the sale qty to base units via the UoM factor (2 coils × 90 = 180 m)", async () => {
    await finalizeKacha({ lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "2" }] }, ctx);
    const mv = lastCreateData(tx.stockMovement.create);
    // Movement stores the signed (−) base qty.
    expect((mv.baseQty as { toString(): string }).toString()).toBe("-180");
  });

  it("audits the kacha as an unattributed stock-out (movement target, no bill/value)", async () => {
    await finalizeKacha({ lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "2" }] }, ctx);
    expect(tableCalls.auditLog).toEqual(["create"]);
    const a = lastCreateData(tx.auditLog.create);
    expect(a.action).toBe("bill.kacha.create");
    expect(a.targetType).toBe("StockMovement");
    expect(a.actorStaffId).toBe("owner_1");
  });
});
