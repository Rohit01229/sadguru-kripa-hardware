// Purchase orders (21c) — myBillBook's Purchase Order screen.
//
// What you asked a supplier to send, before it arrives. The buying-side mirror of the
// pre-sale documents (21): same shape, same convert-by-prefill flow, so a shopkeeper
// learns the pattern once and it works in both directions.
//
//   estimate  → convert → bill        (stock OUT at bill time)
//   purchase order → receive → GRN    (stock IN at receipt time)
//
// A PO moves NO stock and creates no payable. It becomes real when the goods turn up
// and a GoodsReceipt is recorded through the ordinary, already-tested recordGrn path —
// not a second one.
//
// No GST here, deliberately, unlike a sales document. A GoodsReceipt stores
// `costPerBaseUnit` and nothing else, so a tax figure entered on an order would vanish
// silently on receipt — the "switch that does nothing" problem (19 §10). Quantity ×
// rate is what a small shop's purchase order actually says.
import Decimal from "decimal.js";
import { Prisma, prisma, runTx, type Tx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise, fromPaise } from "../shared/money";
import type { Id } from "../shared/types";
import { financialYear } from "../billing/numbering";
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  cancelPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  type CreatePurchaseOrderInput,
  type UpdatePurchaseOrderInput,
  type CancelPurchaseOrderInput,
  type ListPurchaseOrdersQuery,
} from "./schema";

// ─────────────────── Permissions ───────────────────
// Ordering goods is a weaker power than receiving them: anyone trusted to book stock
// into the shop can certainly ask a supplier for a price. Reusing the stock keys keeps
// this out of the RBAC seed and cannot widen anyone's access.
const WRITE_PERMISSION = "stock.grn" as const;
const READ_PERMISSION = "stock.read" as const;

export interface PurchaseCtx {
  session: Session;
  requestId?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

function qty3(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(3));
}
function money2(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(2));
}

interface CounterRow {
  lastNo: number;
}

/**
 * Next order number for (shop, FY), under the same UPDATE … RETURNING row lock the
 * invoice counter uses so two people raising orders at once cannot collide.
 */
export async function nextPurchaseOrderNo(tx: Tx, shopId: string, fy: string): Promise<string> {
  await tx.purchaseOrderCounter.upsert({
    where: { shopId_fy: { shopId, fy } },
    create: { shopId, fy, lastNo: 0 },
    update: {},
  });
  const rows = await tx.$queryRaw<CounterRow[]>`
    UPDATE "PurchaseOrderCounter"
    SET "lastNo" = "lastNo" + 1
    WHERE "shopId" = ${shopId} AND "fy" = ${fy}
    RETURNING "lastNo"`;
  return `PO/${fy}/${String(rows[0]!.lastNo).padStart(6, "0")}`;
}

// ─────────────────── DTOs ───────────────────
export interface PurchaseOrderLineDTO {
  productId: Id;
  productName: string;
  productSku: string;
  receiveUnitId: Id;
  /** Human label for the ordered unit, e.g. "Bag". */
  unitLabel: string;
  /** Quantity in the receive unit. */
  quantity: string;
  /** Paise. */
  costPerUnit: number;
  amount: number;
}

export interface PurchaseOrderDTO {
  id: Id;
  fy: string;
  poNo: string;
  supplierId: Id;
  supplierName: string;
  date: string;
  expectedDate: string | null;
  notes: string | null;
  lines: PurchaseOrderLineDTO[];
  /** Paise. */
  subtotal: number;
  status: "OPEN" | "RECEIVED" | "CANCELLED";
  cancelledReason: string | null;
  receivedGrnId: Id | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const poInclude = {
  lines: {
    orderBy: { sortOrder: "asc" },
    include: { product: { select: { name: true, sku: true } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderWith = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

/**
 * Unit labels for display, in one query across every line of every order on a page —
 * rather than a nested include that would repeat the join per line.
 */
async function unitLabelsFor(receiveUnitIds: string[]): Promise<Map<string, string>> {
  if (receiveUnitIds.length === 0) return new Map();
  const rows = await prisma.productSaleUnit.findMany({
    where: { id: { in: [...new Set(receiveUnitIds)] } },
    select: { id: true, unit: { select: { code: true, name: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.unit.name || r.unit.code]));
}

function toDTO(po: PurchaseOrderWith, unitLabels: Map<string, string>): PurchaseOrderDTO {
  return {
    id: po.id,
    fy: po.fy,
    poNo: po.poNo,
    supplierId: po.supplierId,
    supplierName: po.supplierNameSnap,
    date: po.date.toISOString(),
    expectedDate: po.expectedDate?.toISOString() ?? null,
    notes: po.notes,
    lines: po.lines.map((l) => ({
      productId: l.productId,
      productName: l.product.name,
      productSku: l.product.sku,
      receiveUnitId: l.receiveUnitId,
      unitLabel: unitLabels.get(l.receiveUnitId) ?? "",
      quantity: l.quantity.toString(),
      costPerUnit: toPaise(l.costPerUnit),
      amount: toPaise(l.amount),
    })),
    subtotal: toPaise(po.subtotal),
    status: po.status,
    cancelledReason: po.cancelledReason,
    receivedGrnId: po.receivedGrnId,
    receivedAt: po.receivedAt?.toISOString() ?? null,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
  };
}

/**
 * Validate every line against the catalog and price it. The (product, receiveUnit)
 * pair is checked to belong together and to this shop — the same guard billing uses,
 * so a tampered payload cannot order unit A of product B.
 */
async function priceLines(
  tx: Tx,
  shopId: string,
  lines: CreatePurchaseOrderInput["lines"],
): Promise<{
  rows: Omit<Prisma.PurchaseOrderLineCreateManyInput, "purchaseOrderId">[];
  subtotal: Decimal;
}> {
  const rows: Omit<Prisma.PurchaseOrderLineCreateManyInput, "purchaseOrderId">[] = [];
  let subtotal = new Decimal(0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const su = await tx.productSaleUnit.findFirst({
      where: { id: line.receiveUnitId, productId: line.productId, shopId },
      select: { id: true },
    });
    if (!su) {
      throw new DomainError(
        `Unit ${line.receiveUnitId} does not belong to product ${line.productId}`,
        "NOT_FOUND",
      );
    }

    const cost = fromPaise(line.costPerUnit);
    const amount = cost.times(line.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.plus(amount);

    rows.push({
      shopId,
      productId: line.productId,
      receiveUnitId: line.receiveUnitId,
      quantity: qty3(line.quantity),
      costPerUnit: money2(cost),
      amount: money2(amount),
      sortOrder: i,
    });
  }

  return { rows, subtotal };
}

async function requireSupplier(tx: Tx, shopId: string, supplierId: string): Promise<string> {
  const s = await tx.supplier.findFirst({
    where: { id: supplierId, shopId },
    select: { name: true },
  });
  if (!s) throw new DomainError("That supplier was not found.", "NOT_FOUND");
  return s.name;
}

// ─────────────────── Writes ───────────────────
export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
  ctx: PurchaseCtx,
): Promise<PurchaseOrderDTO> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);
  const data = createPurchaseOrderSchema.parse(input);

  // The series follows the DOCUMENT date, so a back-dated order lands in the financial
  // year it belongs to (21b §5).
  const date = data.date ? new Date(data.date) : new Date();
  const fy = financialYear(date);

  const po = await runTx(async (tx) => {
    const supplierName = await requireSupplier(tx, shopId, data.supplierId);
    const poNo = await nextPurchaseOrderNo(tx, shopId, fy);
    const { rows, subtotal } = await priceLines(tx, shopId, data.lines);

    const created = await tx.purchaseOrder.create({
      data: {
        shopId,
        fy,
        poNo,
        supplierId: data.supplierId,
        supplierNameSnap: supplierName,
        date,
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        notes: data.notes ?? null,
        subtotal: money2(subtotal),
        createdById: ctx.session.userId,
        lines: { createMany: { data: rows } },
      },
      include: poInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "purchaseorder.create",
      targetType: "PurchaseOrder",
      targetId: created.id,
      after: { poNo, supplier: supplierName, subtotal: created.subtotal.toString(), lines: rows.length },
      requestId: ctx.requestId,
    });
    return created;
  });

  return toDTO(po, await unitLabelsFor(po.lines.map((l) => l.receiveUnitId)));
}

export async function updatePurchaseOrder(
  input: UpdatePurchaseOrderInput,
  ctx: PurchaseCtx,
): Promise<PurchaseOrderDTO> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);
  const data = updatePurchaseOrderSchema.parse(input);

  const po = await runTx(async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({
      where: { id: data.id, shopId },
      select: { id: true, status: true, subtotal: true },
    });
    if (!existing) throw new DomainError("That order was not found.", "NOT_FOUND");
    // A received order is the record of what was ordered before the goods arrived.
    // Editing it would rewrite history the goods receipt already relies on.
    if (existing.status !== "OPEN") {
      throw new DomainError(
        existing.status === "RECEIVED"
          ? "Goods have already been received against this order, so it can no longer be changed."
          : "This order is cancelled and can no longer be changed.",
        "PO_NOT_EDITABLE",
      );
    }

    const supplierName = await requireSupplier(tx, shopId, data.supplierId);
    const { rows, subtotal } = await priceLines(tx, shopId, data.lines);

    // Full replace, so the stored subtotal and the lines it came from always commit
    // together and cannot drift.
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: existing.id, shopId } });

    const updated = await tx.purchaseOrder.update({
      where: { id: existing.id },
      data: {
        supplierId: data.supplierId,
        supplierNameSnap: supplierName,
        // The date may be corrected; the number is NOT re-minted, because the supplier
        // may already be holding a copy that carries it.
        ...(data.date ? { date: new Date(data.date) } : {}),
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        notes: data.notes ?? null,
        subtotal: money2(subtotal),
        lines: { createMany: { data: rows } },
      },
      include: poInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "purchaseorder.update",
      targetType: "PurchaseOrder",
      targetId: existing.id,
      before: { subtotal: existing.subtotal.toString() },
      after: { subtotal: updated.subtotal.toString(), lines: rows.length },
      requestId: ctx.requestId,
    });
    return updated;
  });

  return toDTO(po, await unitLabelsFor(po.lines.map((l) => l.receiveUnitId)));
}

export async function cancelPurchaseOrder(
  input: CancelPurchaseOrderInput,
  ctx: PurchaseCtx,
): Promise<PurchaseOrderDTO> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);
  const data = cancelPurchaseOrderSchema.parse(input);

  const po = await runTx(async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({
      where: { id: data.id, shopId },
      select: { id: true, status: true, poNo: true },
    });
    if (!existing) throw new DomainError("That order was not found.", "NOT_FOUND");
    if (existing.status === "RECEIVED") {
      throw new DomainError(
        "Goods have already been received against this order. Adjust the stock instead.",
        "PO_ALREADY_RECEIVED",
      );
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: existing.id },
      data: { status: "CANCELLED", cancelledReason: data.reason },
      include: poInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "purchaseorder.cancel",
      targetType: "PurchaseOrder",
      targetId: existing.id,
      after: { poNo: existing.poNo, reason: data.reason },
      requestId: ctx.requestId,
    });
    return updated;
  });

  return toDTO(po, await unitLabelsFor(po.lines.map((l) => l.receiveUnitId)));
}

/**
 * Stamp an order as received, AFTER the goods receipt exists. Called by the GRN path,
 * never instead of it — the stock is booked in either way, so a failure here is a
 * warning to retry, not a lost receipt.
 *
 * The `status: "OPEN"` guard inside the updateMany is what makes double-receiving
 * impossible: two people racing the same order each record their own GRN, but only one
 * update matches and the second is told so rather than silently overwriting the link.
 */
export async function markPurchaseOrderReceived(
  purchaseOrderId: Id,
  grnId: Id,
  ctx: PurchaseCtx,
): Promise<void> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);

  await runTx(async (tx) => {
    const result = await tx.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, shopId, status: "OPEN" },
      data: { status: "RECEIVED", receivedGrnId: grnId, receivedAt: new Date() },
    });
    if (result.count === 0) {
      throw new DomainError(
        "That order is no longer open — goods may already have been received against it.",
        "PO_NOT_OPEN",
      );
    }
    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "purchaseorder.receive",
      targetType: "PurchaseOrder",
      targetId: purchaseOrderId,
      after: { grnId },
      requestId: ctx.requestId,
    });
  });
}

// ─────────────────── Reads ───────────────────
export interface PurchaseOrderPage {
  data: PurchaseOrderDTO[];
  pageInfo: { hasNextPage: boolean; nextCursor: string | null };
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

export async function listPurchaseOrders(
  shopId: string,
  query: ListPurchaseOrdersQuery = {},
): Promise<PurchaseOrderPage> {
  const { status, supplierId, from, to, q, cursor, limit } =
    listPurchaseOrdersQuerySchema.parse(query);

  const where: Prisma.PurchaseOrderWhereInput = { shopId };
  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { poNo: { contains: q, mode: "insensitive" } },
      { supplierNameSnap: { contains: q, mode: "insensitive" } },
    ];
  }

  const afterId = decodeCursor(cursor);
  const rows = await prisma.purchaseOrder.findMany({
    where,
    include: poInclude,
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  const unitLabels = await unitLabelsFor(page.flatMap((p) => p.lines.map((l) => l.receiveUnitId)));

  return {
    data: page.map((p) => toDTO(p, unitLabels)),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
    },
  };
}

export async function getPurchaseOrder(shopId: string, id: Id): Promise<PurchaseOrderDTO | null> {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, shopId }, include: poInclude });
  if (!po) return null;
  return toDTO(po, await unitLabelsFor(po.lines.map((l) => l.receiveUnitId)));
}

export interface PurchaseCatalogItem {
  id: Id;
  name: string;
  sku: string;
  /** Last known cost per BASE unit, in paise. Seeds the rate field on a new order. */
  costPerBaseUnit: number;
  saleUnits: { id: Id; label: string; factorToBase: string }[];
}

/**
 * The catalog projection the order form needs — including cost, which the ordinary
 * product DTOs deliberately omit because the storefront shares them and a shop's
 * buying price is not public. Staff-side only; the page gates it on stock.read.
 */
export async function listPurchaseCatalog(shopId: string): Promise<PurchaseCatalogItem[]> {
  const rows = await prisma.product.findMany({
    where: { shopId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      costPerBaseUnit: true,
      baseUnit: { select: { code: true } },
      saleUnits: {
        orderBy: [{ isDefault: "desc" }, { id: "asc" }],
        select: { id: true, factorToBase: true, unit: { select: { code: true, name: true } } },
      },
    },
  });

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    costPerBaseUnit: toPaise(p.costPerBaseUnit),
    saleUnits: p.saleUnits.map((su) => ({
      id: su.id,
      // Same "Bag (×50 kg)" shape the goods-receipt form uses, so the two screens read alike.
      label: `${su.unit.name || su.unit.code} (×${su.factorToBase} ${p.baseUnit.code})`,
      factorToBase: su.factorToBase.toString(),
    })),
  }));
}

/** Counts for the list-screen filter chips, in one grouped query. */
export async function purchaseOrderCounts(
  shopId: string,
): Promise<{ open: number; received: number; cancelled: number }> {
  const rows = await prisma.purchaseOrder.groupBy({
    by: ["status"],
    where: { shopId },
    _count: { _all: true },
  });
  const get = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { open: get("OPEN"), received: get("RECEIVED"), cancelled: get("CANCELLED") };
}

export {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  cancelPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
} from "./schema";
export type {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  CancelPurchaseOrderInput,
  ListPurchaseOrdersQuery,
  PurchaseOrderLineInput,
} from "./schema";
