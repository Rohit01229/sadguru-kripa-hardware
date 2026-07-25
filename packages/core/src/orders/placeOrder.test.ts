import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// S6 placeOrder service tests (03 §5, 04 §8.5). Exercise the REAL placeOrder control
// flow (loadLine → toBase UoM → reserveInline guard → totals + delivery fee → Order
// insert) against a mock Tx. Asserts:
//  - totals: itemTotal = Σ unitPrice×qty, delivery fee applied (free above threshold),
//  - 409: a reserve that affects 0 rows throws InsufficientStock (no oversell),
//  - reservation TTL comes from StoreConfig.reservationTtlMinutes,
//  - idempotency response is stored.
// Decimal.js is real; only the db layer is mocked.

interface MockState {
  reserveAffected: number; // rows the reserve UPDATE "affects" (0 ⇒ insufficient)
  reservationTtlMinutes: number;
  deliveryFlatFee: string;
  freeDeliveryThreshold: string | null;
  homeState: string;
  addressState: string;
}

const state: MockState = {
  reserveAffected: 1,
  reservationTtlMinutes: 30,
  deliveryFlatFee: "50",
  freeDeliveryThreshold: "100000",
  homeState: "19",
  addressState: "19",
};

const calls: Record<string, unknown[]> = {};
function rec(name: string, payload: unknown) {
  (calls[name] ??= []).push(payload);
}

function makeTx(PrismaDecimal: typeof DecimalModule.default) {
  const dec = (v: string | number) => new PrismaDecimal(v);
  let orderRow: Record<string, unknown> = {};
  return {
    storeConfig: {
      findUnique: vi.fn(async () => ({
        homeState: state.homeState,
        deliveryFlatFee: dec(state.deliveryFlatFee),
        freeDeliveryThreshold: state.freeDeliveryThreshold === null ? null : dec(state.freeDeliveryThreshold),
        reservationTtlMinutes: state.reservationTtlMinutes,
        gstRoundingMode: "PER_INVOICE",
      })),
    },
    address: {
      findFirst: vi.fn(async () => ({ id: "addr_1", state: state.addressState })),
    },
    productSaleUnit: {
      findFirst: vi.fn(async () => ({
        factorToBase: dec("1"),
        salePrice: dec("100"), // ₹100 per unit
        unit: { code: "pc", kind: "PIECE" },
        product: { isActive: true, availableOnline: true },
      })),
    },
    order: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("order.create", data);
        orderRow = { id: "ord_1", ...data };
        return { id: "ord_1" };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("order.update", data);
        orderRow = { ...orderRow, ...data };
        return orderRow;
      }),
      findUnique: vi.fn(async () => ({
        ...orderRow,
        id: "ord_1",
        orderNo: "ORD-X",
        customerId: "cust_1",
        status: orderRow.status ?? "PENDING_PAYMENT",
        fulfilment: orderRow.fulfilment ?? "DELIVERY",
        addressId: orderRow.addressId ?? "addr_1",
        placeOfSupplyState: orderRow.placeOfSupplyState ?? "19",
        itemTotal: orderRow.itemTotal ?? dec("0"),
        deliveryFee: orderRow.deliveryFee ?? dec("0"),
        grandTotal: orderRow.grandTotal ?? dec("0"),
        paymentStatus: "UNPAID",
        razorpayOrderId: null,
        createdAt: new Date("2026-06-28T11:15:00Z"),
        lines: [],
        reservations: [],
      })),
    },
    reservation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("reservation.create", data);
        return { id: "rsv_1" };
      }),
    },
    customer: { update: vi.fn(async () => ({})) },
    invoice: { findUnique: vi.fn(async () => null) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("auditLog.create", data);
        return { id: "audit_1" };
      }),
    },
    idempotencyKey: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rec("idempotencyKey.create", data);
        return { id: "idem_1" };
      }),
    },
    $executeRaw: vi.fn(async () => {
      rec("$executeRaw", "reserve");
      return state.reserveAffected;
    }),
  };
}

let tx: ReturnType<typeof makeTx>;

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = actual.default;
  return {
    prisma: { idempotencyKey: { findUnique: vi.fn(async () => null) } },
    Prisma: {
      Decimal: PrismaDecimal,
      PrismaClientKnownRequestError: class extends Error {
        code = "P2002";
        meta?: unknown;
      },
    },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

import Decimal from "decimal.js";
import { placeOrder } from "./service";
import { InsufficientStock } from "../shared/errors";

const ctx = {
  session: {
    userId: "acct_1",
    customerId: "cust_1",
    realm: "CUSTOMER" as const,
    roles: ["CUSTOMER"],
    permissions: ["orders.place"],
  },
  requestId: "req_1",
  idempotencyKey: "idem-key-1",
};

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  state.reserveAffected = 1;
  state.reservationTtlMinutes = 30;
  state.deliveryFlatFee = "50";
  state.freeDeliveryThreshold = "100000";
  state.addressState = "19";
  tx = makeTx(Decimal);
});

describe("orders.placeOrder — totals + reservation (04 §8.5)", () => {
  it("reserves each line and computes item total + delivery fee → grand total", async () => {
    const dto = await placeOrder(
      {
        fulfilment: { type: "DELIVERY", addressId: "addr_1" },
        lines: [
          { productId: "p1", saleUnitId: "su1", quantity: "2" },
          { productId: "p2", saleUnitId: "su2", quantity: "3" },
        ],
        paymentMethod: "RAZORPAY",
      },
      ctx,
    );
    // 5 units × ₹100 = ₹500 item total → below ₹100000 threshold → ₹50 delivery.
    const upd = calls["order.update"]![0] as { itemTotal: Decimal; deliveryFee: Decimal; grandTotal: Decimal };
    expect(upd.itemTotal.toNumber()).toBe(500);
    expect(upd.deliveryFee.toNumber()).toBe(50);
    expect(upd.grandTotal.toNumber()).toBe(550);
    // One reservation per line (2 lines).
    expect(calls["reservation.create"]).toHaveLength(2);
    // PENDING_PAYMENT for a RAZORPAY order.
    const created = calls["order.create"]![0] as { status: string };
    expect(created.status).toBe("PENDING_PAYMENT");
    expect(dto.id).toBe("ord_1");
  });

  it("waives delivery fee when the item total reaches the free threshold", async () => {
    state.freeDeliveryThreshold = "400"; // ₹400; order is ₹500 → free
    const r = await placeOrder(
      {
        fulfilment: { type: "DELIVERY", addressId: "addr_1" },
        lines: [{ productId: "p1", saleUnitId: "su1", quantity: "5" }],
        paymentMethod: "PAY_LATER",
      },
      ctx,
    );
    const upd = calls["order.update"]![0] as { deliveryFee: Decimal; grandTotal: Decimal };
    expect(upd.deliveryFee.toNumber()).toBe(0);
    expect(upd.grandTotal.toNumber()).toBe(500);
    // PAY_LATER still reserves (one line) and stands as PAY_LATER.
    expect(calls["reservation.create"]).toHaveLength(1);
    const created = calls["order.create"]![0] as { status: string };
    expect(created.status).toBe("PAY_LATER");
    expect(r.status).toBeDefined();
  });

  it("throws InsufficientStock (→ 409) when a reserve affects 0 rows — no oversell", async () => {
    state.reserveAffected = 0;
    await expect(
      placeOrder(
        {
          fulfilment: { type: "PICKUP" },
          lines: [{ productId: "p1", saleUnitId: "su1", quantity: "1" }],
          paymentMethod: "PAY_LATER",
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(InsufficientStock);
    // No reservation row written when the guard rejected.
    expect(calls["reservation.create"]).toBeUndefined();
  });

  it("derives the reservation TTL from StoreConfig.reservationTtlMinutes", async () => {
    state.reservationTtlMinutes = 45;
    const before = Date.now();
    await placeOrder(
      {
        fulfilment: { type: "PICKUP" },
        lines: [{ productId: "p1", saleUnitId: "su1", quantity: "1" }],
        paymentMethod: "PAY_LATER",
      },
      ctx,
    );
    const res = calls["reservation.create"]![0] as { expiresAt: Date };
    const minutes = (res.expiresAt.getTime() - before) / 60000;
    expect(minutes).toBeGreaterThan(44);
    expect(minutes).toBeLessThan(46);
  });

  it("stores the idempotency response in the same tx", async () => {
    await placeOrder(
      {
        fulfilment: { type: "PICKUP" },
        lines: [{ productId: "p1", saleUnitId: "su1", quantity: "1" }],
        paymentMethod: "PAY_LATER",
      },
      ctx,
    );
    expect(calls["idempotencyKey.create"]).toHaveLength(1);
  });

  it("PICKUP never charges a delivery fee and uses the home state for place-of-supply", async () => {
    const r = await placeOrder(
      {
        fulfilment: { type: "PICKUP" },
        lines: [{ productId: "p1", saleUnitId: "su1", quantity: "1" }],
        paymentMethod: "PAY_LATER",
      },
      ctx,
    );
    const upd = calls["order.update"]![0] as { deliveryFee: Decimal };
    expect(upd.deliveryFee.toNumber()).toBe(0);
    const created = calls["order.create"]![0] as { placeOfSupplyState: string };
    expect(created.placeOfSupplyState).toBe("19"); // home state
    expect(r).toBeDefined();
  });
});
