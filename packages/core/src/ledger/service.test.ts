import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import type * as DecimalModule from "decimal.js";

// S5 ledger POST sign-normalisation + recordPayment idempotency unit tests
// (04 Ledger; 13 §7). post() must store a POSITIVE amount for a debit type and a
// NEGATIVE amount for a credit type regardless of the magnitude sign the caller
// passes, so `outstanding = Σ amount` is always correct. recordPayment must post a
// PAYMENT_CREDIT and be idempotent on the Idempotency-Key.

// Shared mutable state lives in a hoisted block so the vi.mock factory (hoisted to
// the top of the file) can safely reference it.
const h = vi.hoisted(() => {
  return {
    tableCalls: {} as Record<string, unknown[][]>,
    storedIdem: null as { requestHash: string; response: unknown } | null,
  };
});

function recordCall(table: string, args: unknown[]) {
  (h.tableCalls[table] ??= []).push(args);
}

function makeTx() {
  return {
    customer: { findUnique: vi.fn(async () => ({ id: "cust_1" })) },
    ledgerEntry: {
      create: vi.fn(async (args: unknown) => {
        recordCall("ledgerEntry.create", [args]);
        return { id: "le_1" };
      }),
      aggregate: vi.fn(async () => ({ _sum: { amount: new Decimal(0) } })),
    },
    payment: {
      create: vi.fn(async (args: unknown) => {
        recordCall("payment.create", [args]);
        return { id: "pay_1" };
      }),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit_1" })) },
    idempotencyKey: {
      create: vi.fn(async (args: { data: { requestHash: string; response: unknown } }) => {
        h.storedIdem = { requestHash: args.data.requestHash, response: args.data.response };
        return {};
      }),
    },
  };
}

let tx = makeTx();

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  return {
    prisma: {
      idempotencyKey: {
        findUnique: vi.fn(async () =>
          h.storedIdem
            ? { requestHash: h.storedIdem.requestHash, response: h.storedIdem.response, statusCode: 201 }
            : null,
        ),
      },
    },
    Prisma: { Decimal: actual.default, PrismaClientKnownRequestError: class {} },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

import { post, recordPayment } from "./service";

const ctx = {
  session: { userId: "owner_1", realm: "STAFF" as const, roles: ["OWNER"], permissions: ["ledger.write"] },
  requestId: "req_1",
};

function lastData(table: string): Record<string, unknown> {
  const calls = h.tableCalls[table]!;
  const last = calls[calls.length - 1] as unknown[];
  return (last[0] as { data: Record<string, unknown> }).data;
}

describe("ledger.post — sign normalisation by entry type", () => {
  beforeEach(() => {
    for (const k of Object.keys(h.tableCalls)) delete h.tableCalls[k];
    tx = makeTx();
    h.storedIdem = null;
  });

  it("stores a POSITIVE amount for INVOICE_DEBIT (increases what's owed)", async () => {
    await post(tx as never, "cust_1", "INVOICE_DEBIT", 100);
    const d = lastData("ledgerEntry.create");
    expect(d.type).toBe("INVOICE_DEBIT");
    expect(Number((d.amount as { toString(): string }).toString())).toBe(100);
  });

  it("stores a NEGATIVE amount for PAYMENT_CREDIT even when given a positive magnitude", async () => {
    await post(tx as never, "cust_1", "PAYMENT_CREDIT", 250);
    const d = lastData("ledgerEntry.create");
    expect(d.type).toBe("PAYMENT_CREDIT");
    expect(Number((d.amount as { toString(): string }).toString())).toBe(-250);
  });

  it("stores a NEGATIVE amount for CREDIT_NOTE_CREDIT", async () => {
    await post(tx as never, "cust_1", "CREDIT_NOTE_CREDIT", 75);
    const d = lastData("ledgerEntry.create");
    expect(Number((d.amount as { toString(): string }).toString())).toBe(-75);
  });
});

describe("ledger.recordPayment — khata receipt", () => {
  beforeEach(() => {
    for (const k of Object.keys(h.tableCalls)) delete h.tableCalls[k];
    tx = makeTx();
    h.storedIdem = null;
  });

  it("inserts a Payment and posts a PAYMENT_CREDIT to the ledger", async () => {
    const r = await recordPayment("cust_1", { amount: 50000, mode: "CASH" }, ctx);
    expect(r.amount).toBe(50000);
    expect(r.mode).toBe("CASH");
    expect(h.tableCalls["payment.create"]).toHaveLength(1);
    const le = lastData("ledgerEntry.create");
    expect(le.type).toBe("PAYMENT_CREDIT");
    expect(Number((le.amount as { toString(): string }).toString())).toBe(-500);
  });

  it("replays the stored response on an idempotency-key retry (no second payment)", async () => {
    const key = "idem-pay-1";
    const first = await recordPayment("cust_1", { amount: 50000, mode: "CASH" }, { ...ctx, idempotencyKey: key });
    for (const k of Object.keys(h.tableCalls)) delete h.tableCalls[k];
    tx = makeTx();
    const second = await recordPayment("cust_1", { amount: 50000, mode: "CASH" }, { ...ctx, idempotencyKey: key });
    expect(second).toEqual(first);
    expect(h.tableCalls["payment.create"]).toBeUndefined();
  });

  it("rejects a non-positive amount at the Zod boundary", async () => {
    await expect(recordPayment("cust_1", { amount: 0, mode: "CASH" }, ctx)).rejects.toThrow();
  });
});
