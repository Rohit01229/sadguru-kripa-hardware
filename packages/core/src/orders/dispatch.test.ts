import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// S6 dispatch → pakka-on-dispatch (03 §3, §5; 14 Chunk 10). The pivotal transition.
// Exercises the REAL dispatchOrder control flow against a mock Tx:
//  - converts each ACTIVE reservation → final ORDER_DISPATCH_OUT decrement (reserved
//    released + onHand decremented for the SAME base qty → no double-count),
//  - mints the pakka invoice via Billing.buildOrderInvoiceTx in the SAME tx,
//  - INTER-STATE (place-of-supply ≠ home state) → IGST (no CGST/SGST),
//  - flips the order DISPATCHED and audits.
// Decimal.js is real; only the db layer is mocked.

const calls: Record<string, unknown[]> = {};
function rec(name: string, payload?: unknown) {
  (calls[name] ??= []).push(payload ?? true);
}

const state = {
  supplyState: "27", // Maharashtra ≠ home "19" → INTER-STATE → IGST
  homeState: "19",
  orderStatus: "PACKED" as string,
  paymentStatus: "PAID" as string,
};

function makeTx(PrismaDecimal: typeof DecimalModule.default) {
  const dec = (v: string | number) => new PrismaDecimal(v);
  let counter = 0;
  return {
    order: {
      findUnique: vi.fn(async () => ({
        id: "ord_1",
        orderNo: "ORD-X",
        status: state.orderStatus,
        paymentStatus: state.paymentStatus,
        placeOfSupplyState: state.supplyState,
        customer: { id: "cust_1", name: "Acme Traders", gstin: "27ABCDE1234F1Z5" },
        lines: [
          { productId: "p1", saleUnitId: "su1", saleQty: dec("2"), baseQty: dec("2"), unitPrice: dec("100") },
        ],
        reservations: [{ id: "rsv_1", productId: "p1", baseQty: dec("2"), status: "ACTIVE" }],
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("order.update", data);
        return {};
      }),
      findFirst: vi.fn(async () => null),
    },
    reservation: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("reservation.update", data);
        return {};
      }),
    },
    productStock: {},
    stockMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("stockMovement.create", data);
        return { id: "mv_1" };
      }),
    },
    productSaleUnit: {
      findFirst: vi.fn(async () => ({
        id: "su1",
        factorToBase: dec("1"),
        salePrice: dec("100"),
        unit: { code: "pc", kind: "PIECE" },
        product: { id: "p1", gstRate: dec("18"), priceInclusive: false, hsnCode: "8544" },
      })),
    },
    storeConfig: {
      findUnique: vi.fn(async () => ({ homeState: state.homeState, gstRoundingMode: "PER_INVOICE" })),
    },
    invoiceCounter: { upsert: vi.fn(async () => ({})) },
    invoice: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("invoice.create", data);
        return { id: "inv_1", date: new Date("2026-06-28T11:30:00Z"), createdAt: new Date("2026-06-28T11:30:00Z") };
      }),
      findUnique: vi.fn(async () => ({ id: "inv_1", invoiceNo: "2026-27/000001" })),
    },
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("payment.create", data);
        return { id: "pay_1" };
      }),
      findFirst: vi.fn(async () => ({ reference: "pay_RZP123" })),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("auditLog.create", data);
        return { id: "audit_1" };
      }),
    },
    $executeRaw: vi.fn(async () => {
      rec("$executeRaw");
      return 1;
    }),
    $queryRaw: vi.fn(async () => {
      counter += 1;
      return [{ lastNo: counter }];
    }),
  };
}

let tx: ReturnType<typeof makeTx>;

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = actual.default;
  return {
    prisma: {
      order: {
        findUnique: vi.fn(async () => ({
          id: "ord_1",
          orderNo: "ORD-X",
          customerId: "cust_1",
          status: "DISPATCHED",
          fulfilment: "DELIVERY",
          addressId: "addr_1",
          placeOfSupplyState: "27",
          itemTotal: new PrismaDecimal("200"),
          deliveryFee: new PrismaDecimal("0"),
          grandTotal: new PrismaDecimal("236"),
          paymentStatus: "PAID",
          razorpayOrderId: "order_Pqr",
          createdAt: new Date("2026-06-28T11:15:00Z"),
          lines: [{ productId: "p1", saleUnitId: "su1", saleQty: new PrismaDecimal("2"), baseQty: new PrismaDecimal("2"), unitPrice: new PrismaDecimal("100") }],
          reservations: [{ status: "CONVERTED", expiresAt: new Date() }],
        })),
      },
      invoice: { findUnique: vi.fn(async () => ({ id: "inv_1", invoiceNo: "2026-27/000001" })) },
    },
    Prisma: { Decimal: PrismaDecimal },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

import Decimal from "decimal.js";
import { dispatchOrder } from "./service";
import { DomainError } from "../shared/errors";

const ctx = {
  session: { userId: "owner_1", realm: "STAFF" as const, roles: ["OWNER"], permissions: ["orders.fulfil"] },
  requestId: "req_1",
};

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  state.supplyState = "27";
  state.homeState = "19";
  state.orderStatus = "PACKED";
  state.paymentStatus = "PAID";
  tx = makeTx(Decimal);
});

describe("orders.dispatchOrder — convert reservation + pakka-on-dispatch (03 §3,§5)", () => {
  it("converts the reservation to a final ORDER_DISPATCH_OUT decrement (no double-count)", async () => {
    await dispatchOrder("ord_1", {}, ctx);
    // Reservation flipped to CONVERTED, reserved released ($executeRaw), and exactly
    // ONE ORDER_DISPATCH_OUT movement of -2 base units written.
    const resUpd = calls["reservation.update"]![0] as { status: string };
    expect(resUpd.status).toBe("CONVERTED");
    expect(calls["stockMovement.create"]).toHaveLength(1);
    const mv = calls["stockMovement.create"]![0] as { kind: string; baseQty: Decimal; refType: string };
    expect(mv.kind).toBe("ORDER_DISPATCH_OUT");
    expect(new Decimal(mv.baseQty.toString()).toNumber()).toBe(-2);
    expect(mv.refType).toBe("ORDER");
  });

  it("mints the pakka invoice with IGST for an INTER-STATE delivery (27 ≠ home 19)", async () => {
    const { invoice } = await dispatchOrder("ord_1", {}, ctx);
    expect(calls["invoice.create"]).toHaveLength(1);
    const inv = calls["invoice.create"]![0] as { igstTotal: Decimal; cgstTotal: Decimal; sgstTotal: Decimal; orderId: string };
    // 2 × ₹100 = ₹200 taxable @ 18% IGST = ₹36; no CGST/SGST inter-state.
    expect(new Decimal(inv.igstTotal.toString()).toNumber()).toBe(36);
    expect(new Decimal(inv.cgstTotal.toString()).toNumber()).toBe(0);
    expect(new Decimal(inv.sgstTotal.toString()).toNumber()).toBe(0);
    expect(inv.orderId).toBe("ord_1"); // tied 1:1 to the order
    expect(invoice.taxKind).toBe("IGST");
    expect(invoice.igstTotal).toBe(3600); // paise
  });

  it("mints CGST+SGST for an INTRA-STATE delivery (supply == home)", async () => {
    state.supplyState = "19"; // same as home → intra-state
    const { invoice } = await dispatchOrder("ord_1", {}, ctx);
    const inv = calls["invoice.create"]![0] as { igstTotal: Decimal; cgstTotal: Decimal; sgstTotal: Decimal };
    expect(new Decimal(inv.cgstTotal.toString()).toNumber()).toBe(18); // half of 36
    expect(new Decimal(inv.sgstTotal.toString()).toNumber()).toBe(18);
    expect(new Decimal(inv.igstTotal.toString()).toNumber()).toBe(0);
    expect(invoice.taxKind).toBe("CGST_SGST");
  });

  it("records the gateway Payment on a prepaid order's invoice (referencing the razorpay payment id)", async () => {
    await dispatchOrder("ord_1", {}, ctx);
    expect(calls["payment.create"]).toHaveLength(1);
    const pay = calls["payment.create"]![0] as { reference: string; mode: string };
    expect(pay.mode).toBe("CARD");
    expect(pay.reference).toBe("pay_RZP123");
  });

  it("flips the order to DISPATCHED and audits the dispatch", async () => {
    await dispatchOrder("ord_1", {}, ctx);
    const upd = calls["order.update"]!.find((u) => (u as { status?: string }).status === "DISPATCHED");
    expect(upd).toBeDefined();
    const audit = calls["auditLog.create"]![0] as { action: string };
    expect(audit.action).toBe("orders.dispatch");
  });

  it("refuses to dispatch an order that is not PACKED (422 INVALID_TRANSITION)", async () => {
    state.orderStatus = "CONFIRMED";
    await expect(dispatchOrder("ord_1", {}, ctx)).rejects.toBeInstanceOf(DomainError);
  });

  it("refuses to dispatch an already-dispatched order (no double invoice)", async () => {
    state.orderStatus = "DISPATCHED";
    await expect(dispatchOrder("ord_1", {}, ctx)).rejects.toMatchObject({ code: "ALREADY_DISPATCHED" });
  });
});
