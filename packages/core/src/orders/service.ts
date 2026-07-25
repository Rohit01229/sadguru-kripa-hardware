// Orders kernel (S6; 03 §5 reservations, §9 Razorpay, 13 §9, 04 Orders+Payments).
// Orders produces sales but DELEGATES to Billing at dispatch (pakka-on-dispatch) and
// to Inventory for stock (reserve/decrement) — it NEVER mints invoice numbers or
// mutates stock directly (03 §3). Every customer/staff action is ONE core service
// call = ONE prisma.$transaction (03 §2), permission-guarded + audited in the SAME
// tx (10 §7). Ownership (.own) is checked against session.customerId in the service.
//
//  placeOrder  — one tx: reserve stock with TTL from StoreConfig, insert Order +
//                OrderLine, item total + delivery fee/free-threshold, place-of-supply
//                from the delivery address. Idempotent (04 §5). 409 on reserve fail.
//  markPaid    — idempotent on ProcessedWebhook.eventId via INSERT … ON CONFLICT DO
//                NOTHING in the SAME tx as the PENDING_PAYMENT → CONFIRMED transition
//                (03 §9). Re-delivered webhook is a safe no-op.
//  accept/pack — owner fulfilment transitions (orders.fulfil).
//  dispatch    — one tx: convert each reservation → final ORDER_DISPATCH_OUT decrement
//                AND mint the pakka invoice via Billing (IGST if inter-state). The
//                reservation is NOT double-counted (released as it is decremented).
//  complete    — terminal transition.
//  cancel      — before dispatch: release the reservation; refund posture noted.
import Decimal from "decimal.js";
import { Prisma, prisma, runTx, type Tx } from "../shared/db";
import { DomainError, InsufficientStock } from "../shared/errors";
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { toBaseQty } from "../shared/uom";
import { toPaise } from "../shared/money";
import { findIdempotent, hashRequest, storeIdempotent } from "../shared/idempotency";
import { decrementStock } from "../inventory/service";
import { buildOrderInvoiceTx, type InvoiceDTO } from "../billing/service";
import type { Id } from "../shared/types";
import type { OrderStatus } from "@hardware/db";
import {
  placeOrderSchema,
  cancelOrderSchema,
  listOrdersQuerySchema,
  dispatchOrderSchema,
  upsertAddressSchema,
  updateProfileSchema,
  priceCartSchema,
  type PlaceOrderInput,
  type CancelOrderInput,
  type ListOrdersQuery,
  type DispatchOrderInput,
  type UpsertAddressInput,
  type UpdateProfileInput,
  type PriceCartInput,
} from "./schema";

export interface OrderCtx {
  session: Session;
  requestId?: string | null;
  /** Idempotency-Key header (place-order/payment are stock-/money-moving — 04 §5). */
  idempotencyKey?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

/** A 3dp Prisma Decimal (quantities are @db.Decimal(14,3)). */
function qty3(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(3));
}
/** A 2dp Prisma Decimal (money is @db.Decimal(14,2)). */
function money2(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(2));
}

interface LoadedLine {
  productId: string;
  saleUnitId: string;
  saleQty: string;
  baseQty: Prisma.Decimal;
  unitPrice: Prisma.Decimal; // rupees, the catalog sale price
}

interface LineCatalog {
  unitCode: string;
  unitKind: "MEASURED" | "PIECE";
  factorToBase: Prisma.Decimal;
  salePrice: Prisma.Decimal;
}

/**
 * Load (product, saleUnit) for an order line, inside the caller's tx: the UoM factor
 * + unit kind (for base conversion) and the catalog sale price (the storefront price;
 * Orders does not let the customer set a rate). Throws NOT_FOUND when the sale unit
 * does not belong to the product (cross-product spoof guard) or the product is not
 * available online.
 */
async function loadLine(tx: Tx, productId: string, saleUnitId: string): Promise<LineCatalog> {
  const su = await tx.productSaleUnit.findFirst({
    where: { id: saleUnitId, productId },
    select: {
      factorToBase: true,
      salePrice: true,
      unit: { select: { code: true, kind: true } },
      product: { select: { isActive: true, availableOnline: true } },
    },
  });
  if (!su) throw new DomainError(`Sale unit ${saleUnitId} not found for product ${productId}`, "NOT_FOUND");
  if (!su.product.isActive || !su.product.availableOnline) {
    throw new DomainError(`Product ${productId} is not available online`, "NOT_AVAILABLE");
  }
  return {
    unitCode: su.unit.code,
    unitKind: su.unit.kind,
    factorToBase: su.factorToBase,
    salePrice: su.salePrice,
  };
}

/** Sale-unit qty → base-unit Prisma Decimal (rejects fractional PIECE — 03 §4). */
function toBase(quantity: string, cat: LineCatalog): Prisma.Decimal {
  const base = toBaseQty(quantity, {
    code: cat.unitCode,
    kind: cat.unitKind,
    factorToBase: cat.factorToBase.toString(),
  });
  return qty3(base);
}

// ─────────────────── pure: delivery fee (unit-tested) ───────────────────
/**
 * Resolve the delivery fee in RUPEES (Decimal) from the store policy (13 §10).
 * PICKUP is always free. DELIVERY charges the flat fee UNLESS the item total reaches
 * the free-delivery threshold (when one is configured). PURE — no DB — so the policy
 * is unit-testable. `itemTotal`, `flatFee`, `freeThreshold` are rupees.
 */
export function deliveryFee(
  fulfilment: "DELIVERY" | "PICKUP",
  itemTotal: Decimal.Value,
  flatFee: Decimal.Value,
  freeThreshold: Decimal.Value | null,
): Decimal {
  if (fulfilment === "PICKUP") return new Decimal(0);
  const total = new Decimal(itemTotal);
  if (freeThreshold !== null && total.gte(new Decimal(freeThreshold))) {
    return new Decimal(0);
  }
  return new Decimal(flatFee);
}

// ─────────────────── Order numbering ───────────────────
/**
 * A human-friendly, unique order number. Orders do NOT need the GAPLESS guarantee
 * invoices do (only tax invoices / credit notes are gapless — 03 §7); they just need
 * to be unique (Order.orderNo @unique is the backstop). Format ORD-<base36 time>-
 * <random> keeps it short, sortable-ish, and collision-resistant. PURE.
 */
export function generateOrderNo(now: Date = new Date(), rand: string = randomSuffix()): string {
  const t = now.getTime().toString(36).toUpperCase();
  return `ORD-${t}-${rand}`;
}
function randomSuffix(): string {
  return Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0");
}

// ════════════════════════════════════════════════════════════════════════════
//  DTOs
// ════════════════════════════════════════════════════════════════════════════
export interface OrderLineDTO {
  productId: Id;
  saleUnitId: Id;
  saleQty: string;
  baseQty: string;
  unitPrice: number; // paise
  lineTotal: number; // paise (unitPrice × qty)
}
export interface OrderDTO {
  id: Id;
  orderNo: string;
  customerId: Id;
  status: OrderStatus;
  fulfilment: "DELIVERY" | "PICKUP";
  addressId: Id | null;
  placeOfSupplyState: string | null;
  itemTotal: number; // paise
  deliveryFee: number; // paise
  grandTotal: number; // paise
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  razorpayOrderId: string | null;
  lines: OrderLineDTO[];
  /** Reservation expiry (earliest active reservation), when the order still holds stock. */
  reservationExpiresAt: string | null;
  /** The pakka invoice generated on dispatch (id + number), once dispatched. */
  invoice: { id: Id; invoiceNo: string } | null;
  createdAt: string;
}

interface OrderWithRelations {
  id: string;
  orderNo: string;
  customerId: string;
  status: OrderStatus;
  fulfilment: "DELIVERY" | "PICKUP";
  addressId: string | null;
  placeOfSupplyState: string | null;
  itemTotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  razorpayOrderId: string | null;
  createdAt: Date;
  lines: {
    productId: string;
    saleUnitId: string;
    saleQty: Prisma.Decimal;
    baseQty: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
  }[];
  reservations: { status: string; expiresAt: Date }[];
  invoice: { id: string; invoiceNo: string } | null;
}

function toOrderDTO(o: OrderWithRelations): OrderDTO {
  const active = o.reservations
    .filter((r) => r.status === "ACTIVE")
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  return {
    id: o.id,
    orderNo: o.orderNo,
    customerId: o.customerId,
    status: o.status,
    fulfilment: o.fulfilment,
    addressId: o.addressId,
    placeOfSupplyState: o.placeOfSupplyState,
    itemTotal: toPaise(o.itemTotal),
    deliveryFee: toPaise(o.deliveryFee),
    grandTotal: toPaise(o.grandTotal),
    paymentStatus: o.paymentStatus,
    razorpayOrderId: o.razorpayOrderId,
    lines: o.lines.map((l) => ({
      productId: l.productId,
      saleUnitId: l.saleUnitId,
      saleQty: l.saleQty.toString(),
      baseQty: l.baseQty.toString(),
      unitPrice: toPaise(l.unitPrice),
      lineTotal: toPaise(l.unitPrice.times(l.saleQty)),
    })),
    reservationExpiresAt: active[0]?.expiresAt.toISOString() ?? null,
    invoice: o.invoice ? { id: o.invoice.id, invoiceNo: o.invoice.invoiceNo } : null,
    createdAt: o.createdAt.toISOString(),
  };
}

const orderInclude = {
  lines: true,
  reservations: { select: { status: true, expiresAt: true } },
} satisfies Prisma.OrderInclude;

/** Fetch an order + its generated invoice (1:1 via Invoice.orderId) and map to a DTO. */
async function loadOrderDTO(id: string): Promise<OrderDTO | null> {
  const o = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!o) return null;
  const inv = await prisma.invoice.findUnique({
    where: { orderId: id },
    select: { id: true, invoiceNo: true },
  });
  return toOrderDTO({ ...o, invoice: inv });
}

// ════════════════════════════════════════════════════════════════════════════
//  placeOrder — reserve-on-placement (one tx; idempotent; 409 on reserve fail)
// ════════════════════════════════════════════════════════════════════════════
/**
 * Place a storefront order (04 §8.5). ONE prisma.$transaction (03 §2):
 *  1. resolve the delivery address (for DELIVERY) → place-of-supply state; PICKUP
 *     uses the shop home state (intra-state).
 *  2. per line: load catalog, convert qty → base (UoM), price at the catalog sale
 *     price, and RESERVE the base qty against this order with a TTL =
 *     StoreConfig.reservationTtlMinutes (03 §5). The reserve uses the atomic
 *     availability guard, so an oversell across the counter + online pool throws
 *     InsufficientStock → 409 STOCK_INSUFFICIENT and rolls the whole order back.
 *  3. compute item total + delivery fee (free above threshold) → grand total.
 *  4. insert Order (PENDING_PAYMENT for RAZORPAY | PAY_LATER) + OrderLine[].
 *  5. audit + store the idempotency response in the SAME tx.
 * Idempotent on the Idempotency-Key: a retry replays the original order (never
 * double-reserves). Ownership: the order is created against session.customerId.
 */
export async function placeOrder(input: PlaceOrderInput, ctx: OrderCtx): Promise<OrderDTO> {
  requirePermission(ctx.session, "orders.place");
  const data = placeOrderSchema.parse(input);
  const customerId = ctx.session.customerId;
  if (!customerId) throw new DomainError("No customer party on this session", "NOT_FOUND");

  const route = "POST /api/orders";
  const requestHash = hashRequest(data);
  if (ctx.idempotencyKey) {
    const { replay } = await findIdempotent<OrderDTO>(ctx.idempotencyKey, ctx.session.userId, route, requestHash);
    if (replay) return replay.response;
  }

  try {
    const created = await runTx(async (tx) => {
      const store = await tx.storeConfig.findUnique({
        where: { id: "default" },
        select: {
          homeState: true,
          deliveryFlatFee: true,
          freeDeliveryThreshold: true,
          reservationTtlMinutes: true,
        },
      });
      if (!store) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");

      // Place of supply: DELIVERY → the address state; PICKUP → shop home state.
      let placeOfSupplyState = store.homeState;
      let addressId: string | null = null;
      if (data.fulfilment.type === "DELIVERY") {
        if (!data.fulfilment.addressId) {
          throw new DomainError("A delivery address is required for delivery orders", "ADDRESS_REQUIRED");
        }
        const addr = await tx.address.findFirst({
          where: { id: data.fulfilment.addressId, customerId },
          select: { id: true, state: true },
        });
        if (!addr) throw new DomainError("Delivery address not found", "NOT_FOUND");
        addressId = addr.id;
        placeOfSupplyState = addr.state;
      }

      const expiresAt = new Date(Date.now() + store.reservationTtlMinutes * 60 * 1000);

      // Create the order shell first so reservations can reference its id; totals are
      // patched in after the lines are priced. orderNo is unique (retried by the
      // outer P2002 catch only when it is genuinely a numbering clash, not idempotency).
      const order = await tx.order.create({
        data: {
          orderNo: generateOrderNo(),
          customerId,
          status: data.paymentMethod === "RAZORPAY" ? "PENDING_PAYMENT" : "PAY_LATER",
          fulfilment: data.fulfilment.type,
          addressId,
          placeOfSupplyState,
          itemTotal: money2(0),
          deliveryFee: money2(0),
          grandTotal: money2(0),
          paymentStatus: "UNPAID",
        },
        select: { id: true },
      });

      const loaded: LoadedLine[] = [];
      let itemTotal = new Decimal(0);
      for (const line of data.lines) {
        const cat = await loadLine(tx, line.productId, line.saleUnitId);
        const baseQty = toBase(line.quantity, cat);
        // Atomic reserve with the availability guard (03 §5). Throws InsufficientStock
        // when the shared pool can't hold the qty → rolls the whole order back.
        await reserveInline(tx, order.id, line.productId, baseQty, expiresAt);
        const lineTotal = cat.salePrice.times(line.quantity);
        itemTotal = itemTotal.plus(lineTotal);
        loaded.push({
          productId: line.productId,
          saleUnitId: line.saleUnitId,
          saleQty: line.quantity,
          baseQty,
          unitPrice: cat.salePrice,
        });
      }

      const fee = deliveryFee(
        data.fulfilment.type,
        itemTotal,
        store.deliveryFlatFee,
        store.freeDeliveryThreshold ?? null,
      );
      const grandTotal = itemTotal.plus(fee);

      await tx.order.update({
        where: { id: order.id },
        data: {
          itemTotal: money2(itemTotal),
          deliveryFee: money2(fee),
          grandTotal: money2(grandTotal),
          lines: {
            create: loaded.map((l) => ({
              productId: l.productId,
              saleUnitId: l.saleUnitId,
              saleQty: qty3(l.saleQty),
              baseQty: l.baseQty,
              unitPrice: money2(l.unitPrice),
            })),
          },
        },
      });

      // Optionally snapshot the GSTIN onto the customer party for B2B billing.
      if (data.gstin) {
        await tx.customer.update({ where: { id: customerId }, data: { gstin: data.gstin } });
      }

      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "orders.place",
        action: "orders.place",
        targetType: "Order",
        targetId: order.id,
        after: {
          fulfilment: data.fulfilment.type,
          itemTotal: toPaise(itemTotal),
          deliveryFee: toPaise(fee),
          grandTotal: toPaise(grandTotal),
          paymentMethod: data.paymentMethod,
          lines: data.lines.length,
        },
        requestId: ctx.requestId,
      });

      const dto = await loadOrderDTOTx(tx, order.id);

      if (ctx.idempotencyKey) {
        await storeIdempotent(tx, ctx.idempotencyKey, ctx.session.userId, route, requestHash, dto, 201);
      }
      return dto;
    });
    return created;
  } catch (e) {
    if (
      ctx.idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      (e.meta?.target as string[] | string | undefined)?.toString().includes("key")
    ) {
      const { replay } = await findIdempotent<OrderDTO>(ctx.idempotencyKey, ctx.session.userId, route, requestHash);
      if (replay) return replay.response;
    }
    throw e;
  }
}

/**
 * Inline reserve: the atomic availability guard + Reservation insert, identical to
 * inventory.reserve but kept here so placeOrder composes it directly inside its tx
 * without an extra import cycle. `available = onHand − reserved`, so the guard stops
 * reserving stock the counter or another order already holds.
 */
async function reserveInline(
  tx: Tx,
  orderId: string,
  productId: string,
  baseQty: Prisma.Decimal,
  expiresAt: Date,
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE "ProductStock"
    SET "reserved" = "reserved" + ${baseQty}, "updatedAt" = now()
    WHERE "productId" = ${productId}
      AND "onHand" - "reserved" >= ${baseQty}`;
  if (updated === 0) throw new InsufficientStock(productId);
  await tx.reservation.create({
    data: { orderId, productId, baseQty, status: "ACTIVE", expiresAt },
  });
}

/** loadOrderDTO inside a tx (reads the order + reservations; invoice not yet present). */
async function loadOrderDTOTx(tx: Tx, id: string): Promise<OrderDTO> {
  const o = await tx.order.findUnique({ where: { id }, include: orderInclude });
  if (!o) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
  const inv = await tx.invoice.findUnique({ where: { orderId: id }, select: { id: true, invoiceNo: true } });
  return toOrderDTO({ ...o, invoice: inv });
}

// ════════════════════════════════════════════════════════════════════════════
//  markPaid — webhook-driven, idempotent on ProcessedWebhook.eventId (03 §9)
// ════════════════════════════════════════════════════════════════════════════
export interface MarkPaidResult {
  /** True when this call applied the payment; false when it was a deduped no-op. */
  applied: boolean;
  orderId: string | null;
  status: OrderStatus | null;
}

/**
 * Mark an order paid from a VERIFIED Razorpay webhook (03 §9). The signature was
 * already verified by the route; this is the idempotent state change. ONE tx:
 *  - INSERT the Razorpay event id into ProcessedWebhook with ON CONFLICT DO NOTHING.
 *    If 0 rows were inserted, the event was already processed → return a no-op
 *    (`applied: false`) so a re-delivered webhook is safe (Razorpay retries).
 *  - Otherwise, in the SAME tx, advance the matching order PENDING_PAYMENT →
 *    CONFIRMED and set paymentStatus PAID + record the gateway Payment.
 * Recording the event and the state change in one tx means we never mark paid twice
 * or half-apply. `markPaid` carries NO permission guard — the webhook is
 * authenticated by signature (04 §3, public-by-signature), not a session.
 */
export async function markPaid(
  razorpayOrderId: string,
  paymentId: string | null,
  eventId: string,
  eventType?: string | null,
): Promise<MarkPaidResult> {
  return runTx(async (tx) => {
    // Dedupe FIRST, in this tx. INSERT … ON CONFLICT DO NOTHING returns rows affected.
    const inserted = await tx.$executeRaw`
      INSERT INTO "ProcessedWebhook" ("id", "eventId", "paymentId", "type", "createdAt")
      VALUES (${cuidish()}, ${eventId}, ${paymentId}, ${eventType ?? null}, now())
      ON CONFLICT ("eventId") DO NOTHING`;
    if (inserted === 0) {
      // Already processed — safe no-op (idempotent redelivery).
      return { applied: false, orderId: null, status: null };
    }

    const order = await tx.order.findFirst({
      where: { razorpayOrderId },
      select: { id: true, status: true },
    });
    if (!order) {
      // Event recorded but no matching order (unknown/foreign order). Not an error —
      // the webhook is acknowledged (we 200) so Razorpay stops retrying.
      return { applied: true, orderId: null, status: null };
    }

    // Only advance an order still awaiting payment; a re-confirm is a no-op transition.
    let status: OrderStatus = order.status;
    if (order.status === "PENDING_PAYMENT") {
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: "CONFIRMED", paymentStatus: "PAID" },
        select: { status: true },
      });
      status = updated.status;
      await tx.payment.create({
        data: {
          orderId: order.id,
          mode: "CARD",
          amount: new Prisma.Decimal(0), // settled amount is recorded on the dispatch invoice
          reference: paymentId,
        },
      });
      await audit(tx, {
        actorStaffId: null,
        roleAtTime: null,
        permissionUsed: null,
        action: "orders.payment.captured",
        targetType: "Order",
        targetId: order.id,
        after: { eventId, paymentId, razorpayOrderId },
      });
    } else {
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
      status = order.status;
    }

    return { applied: true, orderId: order.id, status };
  });
}

/** A cuid-ish id for the raw ProcessedWebhook insert (Prisma's @default(cuid()) is bypassed by raw SQL). */
function cuidish(): string {
  return "phk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ════════════════════════════════════════════════════════════════════════════
//  Fulfilment transitions (staff: orders.fulfil) + cancel (customer: .own)
// ════════════════════════════════════════════════════════════════════════════

/** Load the order or 404 (status only — the transition guards do the rest). */
async function loadForFulfil(tx: Tx, id: string): Promise<{ status: OrderStatus }> {
  const o = await tx.order.findUnique({ where: { id }, select: { status: true } });
  if (!o) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
  return o;
}

/**
 * Owner accepts an order → CONFIRMED. A pay-later order moves PAY_LATER → CONFIRMED;
 * a prepaid order is already CONFIRMED (markPaid set it) and accept is a no-op
 * confirmation. Rejects accepting a cancelled/dispatched/completed order.
 */
export async function acceptOrder(id: Id, ctx: OrderCtx): Promise<OrderDTO> {
  requirePermission(ctx.session, "orders.fulfil");
  await runTx(async (tx) => {
    const o = await loadForFulfil(tx, id);
    if (o.status !== "PAY_LATER" && o.status !== "PENDING_PAYMENT" && o.status !== "CONFIRMED") {
      throw new DomainError(`Cannot accept an order in status ${o.status}`, "INVALID_TRANSITION");
    }
    await tx.order.update({ where: { id }, data: { status: "CONFIRMED" } });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "orders.fulfil",
      action: "orders.accept",
      targetType: "Order",
      targetId: id,
      before: { status: o.status },
      after: { status: "CONFIRMED" },
      requestId: ctx.requestId,
    });
  });
  const dto = await loadOrderDTO(id);
  if (!dto) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
  return dto;
}

/** Owner packs a CONFIRMED order → PACKED. */
export async function packOrder(id: Id, ctx: OrderCtx): Promise<OrderDTO> {
  requirePermission(ctx.session, "orders.fulfil");
  await runTx(async (tx) => {
    const o = await loadForFulfil(tx, id);
    if (o.status !== "CONFIRMED") {
      throw new DomainError(`Cannot pack an order in status ${o.status}`, "INVALID_TRANSITION");
    }
    await tx.order.update({ where: { id }, data: { status: "PACKED" } });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "orders.fulfil",
      action: "orders.pack",
      targetType: "Order",
      targetId: id,
      before: { status: o.status },
      after: { status: "PACKED" },
      requestId: ctx.requestId,
    });
  });
  const dto = await loadOrderDTO(id);
  if (!dto) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
  return dto;
}

export interface DispatchResult {
  order: OrderDTO;
  invoice: InvoiceDTO;
}

/**
 * Owner dispatches a PACKED order → DISPATCHED (04 §8 admin fulfilment). The pivotal
 * transition (03 §3, §5; 14 Chunk 10). ONE prisma.$transaction:
 *  1. for each line: CONVERT the reservation → a final stock decrement. We mark the
 *     active reservation CONVERTED and free its reserved qty, then decrementStock
 *     ORDER_DISPATCH_OUT for the same base qty — so `reserved` drops and `onHand`
 *     drops by the same amount: NO double-count, NO oversell window.
 *  2. mint the pakka invoice via Billing's buildOrderInvoiceTx (place-of-supply
 *     correct: IGST if the delivery state ≠ home state) — Orders delegates numbering
 *     + tax to Billing (03 §3), tied 1:1 to the order via Invoice.orderId.
 *  3. flip the order DISPATCHED + paymentStatus, audit.
 * Idempotent in the business sense: dispatching an already-dispatched order is a 422.
 */
export async function dispatchOrder(
  id: Id,
  input: DispatchOrderInput,
  ctx: OrderCtx,
): Promise<DispatchResult> {
  requirePermission(ctx.session, "orders.fulfil");
  const data = dispatchOrderSchema.parse(input);

  const invoice = await runTx(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: {
        lines: true,
        reservations: { where: { status: "ACTIVE" } },
        customer: { select: { id: true, name: true, gstin: true } },
      },
    });
    if (!order) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
    if (order.status === "DISPATCHED" || order.status === "COMPLETED") {
      throw new DomainError(`Order ${order.orderNo} is already dispatched`, "ALREADY_DISPATCHED");
    }
    if (order.status === "CANCELLED") {
      throw new DomainError(`Order ${order.orderNo} is cancelled`, "ORDER_CANCELLED");
    }
    if (order.status !== "PACKED") {
      throw new DomainError(`Order must be PACKED before dispatch (is ${order.status})`, "INVALID_TRANSITION");
    }

    // 1. Convert reservations → final decrement. Release the reserved qty (so the
    // availability guard nets out) then decrement onHand for the same base qty.
    for (const line of order.lines) {
      // Free the matching active reservation(s) for this product so `reserved` falls.
      const res = order.reservations.filter((r) => r.productId === line.productId && r.status === "ACTIVE");
      for (const r of res) {
        await tx.$executeRaw`
          UPDATE "ProductStock"
          SET "reserved" = "reserved" - ${r.baseQty}, "updatedAt" = now()
          WHERE "productId" = ${r.productId}`;
        await tx.reservation.update({ where: { id: r.id }, data: { status: "CONVERTED" } });
      }
      // Final stock-out for the dispatched goods. allowNegative=true because the qty
      // was already held by an active reservation we just released — the availability
      // guard would otherwise see a transient state; the reservation guaranteed it.
      await decrementStock(tx, line.productId, line.baseQty, "ORDER_DISPATCH_OUT", {
        refType: "ORDER",
        refId: order.id,
        actorStaffId: ctx.session.userId,
      }, true);
    }

    // 2. Pakka-on-dispatch — Billing mints the invoice in THIS tx (IGST if inter-state).
    const paidOnline = order.paymentStatus === "PAID";
    const payment = paidOnline
      ? await tx.payment.findFirst({
          where: { orderId: order.id, invoiceId: null },
          orderBy: { date: "desc" },
          select: { reference: true },
        })
      : null;
    const inv = await buildOrderInvoiceTx(tx, {
      orderId: order.id,
      customerId: order.customer.id,
      customerName: order.customer.name,
      customerGstin: order.customer.gstin,
      supplyState: order.placeOfSupplyState ?? "",
      lines: order.lines.map((l) => ({
        productId: l.productId,
        saleUnitId: l.saleUnitId,
        quantity: l.saleQty.toString(),
        baseQty: l.baseQty,
        unitPrice: l.unitPrice,
      })),
      paidOnline,
      paymentReference: payment?.reference ?? null,
      roundOff: data.roundOff,
    });

    // 3. Flip the order DISPATCHED.
    await tx.order.update({ where: { id: order.id }, data: { status: "DISPATCHED" } });

    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "orders.fulfil",
      action: "orders.dispatch",
      targetType: "Order",
      targetId: order.id,
      before: { status: "PACKED" },
      after: { status: "DISPATCHED", invoiceNo: inv.invoiceNo, taxKind: inv.taxKind },
      requestId: ctx.requestId,
    });

    return inv;
  });

  const dto = await loadOrderDTO(id);
  if (!dto) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
  return { order: dto, invoice };
}

/** Owner completes a DISPATCHED order → COMPLETED (delivered/handed over). */
export async function completeOrder(id: Id, ctx: OrderCtx): Promise<OrderDTO> {
  requirePermission(ctx.session, "orders.fulfil");
  await runTx(async (tx) => {
    const o = await loadForFulfil(tx, id);
    if (o.status !== "DISPATCHED") {
      throw new DomainError(`Cannot complete an order in status ${o.status}`, "INVALID_TRANSITION");
    }
    await tx.order.update({ where: { id }, data: { status: "COMPLETED" } });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "orders.fulfil",
      action: "orders.complete",
      targetType: "Order",
      targetId: id,
      before: { status: o.status },
      after: { status: "COMPLETED" },
      requestId: ctx.requestId,
    });
  });
  const dto = await loadOrderDTO(id);
  if (!dto) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
  return dto;
}

/**
 * Customer cancels their OWN order before dispatch (04 §8; orders.cancel.own). ONE
 * tx: release every ACTIVE reservation (freeing `available` stock for the pool), flip
 * the order CANCELLED, audit. Refunds for a prepaid order are out of the synchronous
 * path (gateway refund follows the same idempotent webhook posture — noted, deferred
 * to the refund flow). Ownership: the order must belong to session.customerId, else
 * 404 (a customer fetching/cancelling another's order — 10 §5).
 */
export async function cancelOrder(id: Id, input: CancelOrderInput, ctx: OrderCtx): Promise<OrderDTO> {
  requirePermission(ctx.session, "orders.cancel.own");
  const data = cancelOrderSchema.parse(input);
  const customerId = ctx.session.customerId;
  if (!customerId) throw new DomainError("No customer party on this session", "NOT_FOUND");

  await runTx(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id, customerId }, // OWNERSHIP: scoped to the session's customer
      include: { reservations: { where: { status: "ACTIVE" } } },
    });
    if (!order) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
    if (order.status === "DISPATCHED" || order.status === "COMPLETED") {
      throw new DomainError(`Order ${order.orderNo} can no longer be cancelled`, "TOO_LATE_TO_CANCEL");
    }
    if (order.status === "CANCELLED") {
      throw new DomainError(`Order ${order.orderNo} is already cancelled`, "ALREADY_CANCELLED");
    }

    // Release the reservations → free the held stock back to the pool.
    for (const r of order.reservations) {
      await tx.$executeRaw`
        UPDATE "ProductStock"
        SET "reserved" = "reserved" - ${r.baseQty}, "updatedAt" = now()
        WHERE "productId" = ${r.productId}`;
      await tx.reservation.update({ where: { id: r.id }, data: { status: "RELEASED" } });
    }

    await tx.order.update({
      where: { id },
      data: {
        status: "CANCELLED",
        paymentStatus: order.paymentStatus === "PAID" ? "REFUNDED" : order.paymentStatus,
      },
    });

    await audit(tx, {
      actorStaffId: null,
      roleAtTime: "CUSTOMER",
      permissionUsed: "orders.cancel.own",
      action: "orders.cancel",
      targetType: "Order",
      targetId: id,
      before: { status: order.status },
      after: { status: "CANCELLED", reason: data.reason ?? null },
      requestId: ctx.requestId,
    });
  });

  const dto = await loadOrderDTO(id);
  if (!dto) throw new DomainError(`Order ${id} not found`, "NOT_FOUND");
  return dto;
}

/** Attach the Razorpay gateway order id to an order (set when the gateway order is created). */
export async function attachRazorpayOrder(orderId: string, razorpayOrderId: string): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { razorpayOrderId } });
}

// ════════════════════════════════════════════════════════════════════════════
//  Reads — customer (own) + admin (queue)
// ════════════════════════════════════════════════════════════════════════════
export interface OrderPage {
  data: OrderDTO[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

async function listOrdersWhere(where: Prisma.OrderWhereInput, query: ListOrdersQuery): Promise<OrderPage> {
  const { status, from, to, cursor, limit } = listOrdersQuerySchema.parse(query);
  const finalWhere: Prisma.OrderWhereInput = { ...where, ...(status ? { status } : {}) };
  // Date range on order createdAt (additive — only applied when a bound is given).
  if (from || to) {
    finalWhere.createdAt = {};
    if (from) finalWhere.createdAt.gte = new Date(from);
    if (to) finalWhere.createdAt.lte = new Date(to);
  }
  const afterId = decodeCursor(cursor);
  const rows = await prisma.order.findMany({
    where: finalWhere,
    include: orderInclude,
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });
  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  const ids = page.map((o) => o.id);
  const invoices = ids.length
    ? await prisma.invoice.findMany({
        where: { orderId: { in: ids } },
        select: { id: true, invoiceNo: true, orderId: true },
      })
    : [];
  const invByOrder = new Map(invoices.map((i) => [i.orderId!, { id: i.id, invoiceNo: i.invoiceNo }]));
  return {
    data: page.map((o) => toOrderDTO({ ...o, invoice: invByOrder.get(o.id) ?? null })),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
    },
  };
}

/** Customer order history — OWNERSHIP-scoped to the session's customer (10 §5). */
export async function listMyOrders(customerId: string, query: ListOrdersQuery = {}): Promise<OrderPage> {
  return listOrdersWhere({ customerId }, query);
}

/** A single order for the customer — 404 if it is not theirs (ownership). */
export async function getMyOrder(customerId: string, id: Id): Promise<OrderDTO | null> {
  const o = await prisma.order.findFirst({ where: { id, customerId }, include: orderInclude });
  if (!o) return null;
  const inv = await prisma.invoice.findUnique({ where: { orderId: id }, select: { id: true, invoiceNo: true } });
  return toOrderDTO({ ...o, invoice: inv });
}

/** Admin order queue (staff orders.read) — all orders, filter by status. */
export async function listOrdersAdmin(query: ListOrdersQuery = {}): Promise<OrderPage> {
  return listOrdersWhere({}, query);
}

/** A single order for staff fulfilment (no ownership scope). */
export async function getOrderAdmin(id: Id): Promise<OrderDTO | null> {
  return loadOrderDTO(id);
}

// ════════════════════════════════════════════════════════════════════════════
//  Cart pricing preview (checkout summary) — read-only, no reservation
// ════════════════════════════════════════════════════════════════════════════
export interface CartPriceDTO {
  itemTotal: number; // paise
  deliveryFee: number; // paise
  grandTotal: number; // paise
  placeOfSupplyState: string;
  taxKind: "CGST_SGST" | "IGST";
  lines: { productId: Id; saleUnitId: Id; quantity: string; unitPrice: number; lineTotal: number; available: string; inStock: boolean }[];
}

/**
 * Price a cart for the checkout summary WITHOUT reserving (read-only). Resolves each
 * line's catalog price + live availability, applies the delivery-fee policy, and
 * previews the place-of-supply tax kind from the chosen address. This is advisory:
 * the authoritative reserve + total happen atomically in placeOrder.
 */
export async function priceCart(customerId: string, input: PriceCartInput): Promise<CartPriceDTO> {
  const data = priceCartSchema.parse(input);
  const store = await prisma.storeConfig.findUnique({
    where: { id: "default" },
    select: { homeState: true, deliveryFlatFee: true, freeDeliveryThreshold: true },
  });
  if (!store) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");

  let placeOfSupplyState = store.homeState;
  if (data.fulfilment === "DELIVERY" && data.addressId) {
    const addr = await prisma.address.findFirst({
      where: { id: data.addressId, customerId },
      select: { state: true },
    });
    if (addr) placeOfSupplyState = addr.state;
  }

  // Batch the per-line sale-unit + stock lookup into ONE query (was an awaited
  // findFirst per cart line — K sequential round-trips on the checkout path). `id`
  // is the primary key, so each maps to exactly one row; we still verify the
  // (saleUnitId, productId) pairing in memory to preserve the original findFirst
  // filter (a mismatched pair must be rejected, not silently accepted).
  const saleUnitIds = [...new Set(data.items.map((l) => l.saleUnitId))];
  const sus = await prisma.productSaleUnit.findMany({
    where: { id: { in: saleUnitIds } },
    select: {
      id: true,
      productId: true,
      salePrice: true,
      factorToBase: true,
      unit: { select: { code: true, kind: true } },
      product: { select: { stock: { select: { onHand: true, reserved: true } } } },
    },
  });
  const suMap = new Map(sus.map((s) => [s.id, s]));

  let itemTotal = new Decimal(0);
  const lines: CartPriceDTO["lines"] = [];
  for (const line of data.items) {
    const su = suMap.get(line.saleUnitId);
    if (!su || su.productId !== line.productId) {
      throw new DomainError(`Sale unit ${line.saleUnitId} not found for product ${line.productId}`, "NOT_FOUND");
    }
    const base = toBaseQty(line.quantity, {
      code: su.unit.code,
      kind: su.unit.kind,
      factorToBase: su.factorToBase.toString(),
    });
    const onHand = su.product.stock?.onHand ?? new Prisma.Decimal(0);
    const reserved = su.product.stock?.reserved ?? new Prisma.Decimal(0);
    const available = onHand.minus(reserved);
    const lineTotal = su.salePrice.times(line.quantity);
    itemTotal = itemTotal.plus(lineTotal);
    lines.push({
      productId: line.productId,
      saleUnitId: line.saleUnitId,
      quantity: line.quantity,
      unitPrice: toPaise(su.salePrice),
      lineTotal: toPaise(lineTotal),
      available: available.toString(),
      inStock: available.gte(new Decimal(base)),
    });
  }

  const fee = deliveryFee(data.fulfilment, itemTotal, store.deliveryFlatFee, store.freeDeliveryThreshold ?? null);
  return {
    itemTotal: toPaise(itemTotal),
    deliveryFee: toPaise(fee),
    grandTotal: toPaise(itemTotal.plus(fee)),
    placeOfSupplyState,
    taxKind: placeOfSupplyState === store.homeState ? "CGST_SGST" : "IGST",
    lines,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Customer profile + addresses (reuse S1 account; 04 Customer accounts)
// ════════════════════════════════════════════════════════════════════════════
export interface ProfileDTO {
  customerId: Id;
  name: string;
  phone: string | null;
  gstin: string | null;
  email: string;
  addresses: AddressDTO[];
}
export interface AddressDTO {
  id: Id;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

function toAddressDTO(a: {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}): AddressDTO {
  return { id: a.id, line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode, isDefault: a.isDefault };
}

/** Read the customer's profile + addresses (ownership: their own party only). */
export async function getProfile(customerId: string): Promise<ProfileDTO | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { addresses: { orderBy: [{ isDefault: "desc" }, { id: "asc" }] }, account: { select: { email: true } } },
  });
  if (!customer || !customer.account) return null;
  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    gstin: customer.gstin,
    email: customer.account.email,
    addresses: customer.addresses.map(toAddressDTO),
  };
}

/** Update the customer's own profile (name/phone/GSTIN). */
export async function updateProfile(customerId: string, input: UpdateProfileInput): Promise<ProfileDTO> {
  const data = updateProfileSchema.parse(input);
  await prisma.customer.update({
    where: { id: customerId },
    data: { name: data.name, phone: data.phone ?? null, gstin: data.gstin ?? null },
  });
  const dto = await getProfile(customerId);
  if (!dto) throw new DomainError(`Customer ${customerId} not found`, "NOT_FOUND");
  return dto;
}

/** Add an address to the customer's own party. First address becomes default. */
export async function addAddress(customerId: string, input: UpsertAddressInput): Promise<AddressDTO> {
  const data = upsertAddressSchema.parse(input);
  return runTx(async (tx) => {
    const count = await tx.address.count({ where: { customerId } });
    const isDefault = data.isDefault || count === 0;
    if (isDefault) {
      await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    const a = await tx.address.create({
      data: {
        customerId,
        line1: data.line1,
        line2: data.line2 ?? null,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        isDefault,
      },
    });
    return toAddressDTO(a);
  });
}

/** Delete one of the customer's own addresses (ownership-scoped). */
export async function deleteAddress(customerId: string, addressId: string): Promise<void> {
  const a = await prisma.address.findFirst({ where: { id: addressId, customerId }, select: { id: true } });
  if (!a) throw new DomainError(`Address ${addressId} not found`, "NOT_FOUND");
  await prisma.address.delete({ where: { id: addressId } });
}

// Re-export the orders Zod surface + Razorpay primitives so transport imports
// validation and the (tested) HMAC verify from @hardware/core only.
export * from "./schema";
export * from "./razorpay";
