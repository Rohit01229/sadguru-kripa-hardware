import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// S6 markPaid idempotency (03 §9). The Razorpay event id is deduped via INSERT …
// ON CONFLICT DO NOTHING in the SAME tx as the order state change. We assert:
//  - first delivery (insert affects 1 row) → order advances PENDING_PAYMENT →
//    CONFIRMED + PAID, payment recorded, audited.
//  - REDELIVERY (insert affects 0 rows = conflict) → a safe no-op: NO order update,
//    NO payment, NO audit.

const calls: Record<string, unknown[]> = {};
function rec(name: string, payload?: unknown) {
  (calls[name] ??= []).push(payload ?? true);
}

const state = { insertAffected: 1, orderStatus: "PENDING_PAYMENT" as string };

function makeTx() {
  return {
    $executeRaw: vi.fn(async () => {
      rec("$executeRaw.insertWebhook");
      return state.insertAffected;
    }),
    order: {
      findFirst: vi.fn(async () => ({ id: "ord_1", status: state.orderStatus })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("order.update", data);
        return { status: data.status ?? state.orderStatus };
      }),
    },
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("payment.create", data);
        return { id: "pay_1" };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("auditLog.create", data);
        return { id: "audit_1" };
      }),
    },
  };
}

let tx: ReturnType<typeof makeTx>;

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  return {
    prisma: {},
    Prisma: { Decimal: actual.default },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

import { markPaid } from "./service";

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  state.insertAffected = 1;
  state.orderStatus = "PENDING_PAYMENT";
  tx = makeTx();
});

describe("orders.markPaid — webhook idempotency (03 §9)", () => {
  it("first delivery: advances the order to CONFIRMED + PAID and records the payment", async () => {
    const r = await markPaid("order_Pqr", "pay_1", "evt_1", "payment.captured");
    expect(r.applied).toBe(true);
    expect(r.orderId).toBe("ord_1");
    expect(r.status).toBe("CONFIRMED");
    const upd = calls["order.update"]![0] as { status: string; paymentStatus: string };
    expect(upd.status).toBe("CONFIRMED");
    expect(upd.paymentStatus).toBe("PAID");
    expect(calls["payment.create"]).toHaveLength(1);
    expect(calls["auditLog.create"]).toHaveLength(1);
  });

  it("redelivery (event id conflict, 0 rows inserted): SAFE NO-OP — no state change at all", async () => {
    state.insertAffected = 0; // ON CONFLICT DO NOTHING affected 0 rows
    const r = await markPaid("order_Pqr", "pay_1", "evt_1", "payment.captured");
    expect(r.applied).toBe(false);
    expect(r.orderId).toBeNull();
    // The dedupe short-circuits BEFORE any order/payment/audit write.
    expect(calls["order.update"]).toBeUndefined();
    expect(calls["payment.create"]).toBeUndefined();
    expect(calls["auditLog.create"]).toBeUndefined();
    // But the webhook insert WAS attempted (that is the dedupe).
    expect(calls["$executeRaw.insertWebhook"]).toHaveLength(1);
  });

  it("records the event id but does not re-advance an order already past PENDING_PAYMENT", async () => {
    state.orderStatus = "CONFIRMED";
    const r = await markPaid("order_Pqr", "pay_2", "evt_2");
    expect(r.applied).toBe(true);
    // No CONFIRMED transition / payment for an already-confirmed order; just ensures PAID.
    expect(calls["payment.create"]).toBeUndefined();
    const upd = calls["order.update"]![0] as { paymentStatus: string };
    expect(upd.paymentStatus).toBe("PAID");
  });
});
