// Inventory kernel (03 §5): only Inventory mutates stock. The atomic decrement,
// reservation, and expiry-release primitives all run INSIDE a caller-supplied
// transaction (`Tx`) — they never open their own. Higher slices (S3 GRN/adjust,
// S4 billing, S6 orders) compose these inside their own one-transaction service
// call (03 §2).
//
// S3 (this slice) layers the GRN / adjustment / return / supplier services and the
// stock-report reads (low-stock, near-expiry, movement ledger) on top of the
// kernel — each mutation is ONE prisma.$transaction, permission-guarded, audited in
// the same tx, and writes signed StockMovements. Batch.onHand is kept in parallel
// with ProductStock.onHand (13 §5; reconciliation job noted for S7).
import Decimal from "decimal.js";
import { Prisma, prisma, runTx, type Tx } from "../shared/db";
import { DomainError, InsufficientStock } from "../shared/errors";
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { toBaseQty } from "../shared/uom";
import { fromPaise, toPaise } from "../shared/money";
import { findIdempotent, hashRequest, storeIdempotent } from "../shared/idempotency";
import type { Id } from "../shared/types";
import type { MovementKind } from "@hardware/db";
import {
  recordGrnSchema,
  adjustStockSchema,
  setStockLevelSchema,
  recordReturnSchema,
  stockListQuerySchema,
  movementsQuerySchema,
  nearExpiryQuerySchema,
  upsertSupplierSchema,
  editSupplierSchema,
  type RecordGrnInput,
  type AdjustStockInput,
  type SetStockLevelInput,
  type RecordReturnInput,
  type StockListQuery,
  type MovementsQuery,
  type NearExpiryQuery,
  type UpsertSupplierInput,
  type EditSupplierInput,
} from "./schema";

export interface MovementRef {
  /** INVOICE | GRN | ORDER | ADJUSTMENT | CN — for the movement ledger. */
  refType?: string | null;
  refId?: string | null;
  reason?: string | null;
  /** Staff user attributed to this movement (null for kacha zero-trace). */
  actorStaffId?: string | null;
  batchId?: string | null;
}

/**
 * Atomically remove `baseQty` base units of stock and write a signed
 * StockMovement, inside the caller's transaction (03 §5).
 *
 * The guard is a SINGLE conditional UPDATE:
 *   UPDATE "ProductStock" SET "onHand" = "onHand" - $q
 *   WHERE "productId" = $id AND "onHand" - "reserved" >= $q
 * so the check-and-decrement is one atomic statement — no read-then-write race,
 * no oversell. 0 rows affected ⇒ not enough free stock ⇒ throw InsufficientStock.
 *
 * `allowNegative` bypasses the availability guard (per-product opt-in, or for
 * returns/adjustments policy — 03 §5) but STILL decrements and records the
 * movement. The product's ProductStock row must already exist (created at S2/S3).
 *
 * @param baseQty positive magnitude to remove (NOT pre-negated); the movement is
 *        stored as `-baseQty` (signed: + in, − out — 13 §4).
 */
export async function decrementStock(
  tx: Tx,
  productId: string,
  baseQty: Decimal.Value,
  kind: MovementKind,
  ref: MovementRef = {},
  allowNegative = false,
): Promise<string> {
  const qty = new Decimal(baseQty);
  if (qty.isNegative() || qty.isZero()) {
    throw new InsufficientStock(productId);
  }
  const q = qty.toFixed(3);

  const updated = allowNegative
    ? await tx.$executeRaw`
        UPDATE "ProductStock"
        SET "onHand" = "onHand" - ${new Prisma.Decimal(q)}, "updatedAt" = now()
        WHERE "productId" = ${productId}`
    : await tx.$executeRaw`
        UPDATE "ProductStock"
        SET "onHand" = "onHand" - ${new Prisma.Decimal(q)}, "updatedAt" = now()
        WHERE "productId" = ${productId}
          AND "onHand" - "reserved" >= ${new Prisma.Decimal(q)}`;

  if (updated === 0) throw new InsufficientStock(productId);

  const mv = await tx.stockMovement.create({
    data: {
      productId,
      baseQty: new Prisma.Decimal(qty.negated().toFixed(3)), // signed − out
      kind,
      refType: ref.refType ?? null,
      refId: ref.refId ?? null,
      reason: ref.reason ?? null,
      actorStaffId: ref.actorStaffId ?? null,
      batchId: ref.batchId ?? null,
    },
    select: { id: true },
  });
  return mv.id;
}

/**
 * Atomically increment stock and write a signed (+) StockMovement, inside the
 * caller's transaction. Used by GRN-in, adjustments-in and returns-in (S3). The
 * ProductStock row is upserted so opening stock / first GRN works. Returns the
 * created movement's id (so a caller can reference the exact row even when several
 * movements in one tx share a product/ref).
 */
export async function incrementStock(
  tx: Tx,
  productId: string,
  baseQty: Decimal.Value,
  kind: MovementKind,
  ref: MovementRef = {},
): Promise<string> {
  const qty = new Decimal(baseQty);
  if (qty.isNegative() || qty.isZero()) {
    throw new InsufficientStock(productId);
  }
  const q = new Prisma.Decimal(qty.toFixed(3));

  await tx.productStock.upsert({
    where: { productId },
    create: { productId, onHand: q, reserved: new Prisma.Decimal(0) },
    update: { onHand: { increment: q } },
  });

  const mv = await tx.stockMovement.create({
    data: {
      productId,
      baseQty: q, // signed + in
      kind,
      refType: ref.refType ?? null,
      refId: ref.refId ?? null,
      reason: ref.reason ?? null,
      actorStaffId: ref.actorStaffId ?? null,
      batchId: ref.batchId ?? null,
    },
    select: { id: true },
  });
  return mv.id;
}

/**
 * Reserve `baseQty` against an order with a TTL (03 §5). `available = onHand −
 * reserved`, so the same atomic guard prevents reserving stock the counter or
 * another order already holds. Increments ProductStock.reserved and inserts a
 * Reservation row, both inside the caller's transaction. Throws InsufficientStock
 * if not enough is available.
 */
export async function reserve(
  tx: Tx,
  orderId: string,
  productId: string,
  baseQty: Decimal.Value,
  expiresAt: Date,
): Promise<string> {
  const qty = new Decimal(baseQty);
  if (qty.isNegative() || qty.isZero()) {
    throw new InsufficientStock(productId);
  }
  const q = new Prisma.Decimal(qty.toFixed(3));

  const updated = await tx.$executeRaw`
    UPDATE "ProductStock"
    SET "reserved" = "reserved" + ${q}, "updatedAt" = now()
    WHERE "productId" = ${productId}
      AND "onHand" - "reserved" >= ${q}`;

  if (updated === 0) throw new InsufficientStock(productId);

  const row = await tx.reservation.create({
    data: { orderId, productId, baseQty: q, status: "ACTIVE", expiresAt },
    select: { id: true },
  });
  return row.id;
}

export interface ReleaseResult {
  released: number;
}

/**
 * Release every ACTIVE reservation past its `expiresAt`, freeing `available`
 * stock (03 §5, §10 reservation-expiry job). Idempotent and safe to retry: it
 * only ever acts on rows still ACTIVE, decrements ProductStock.reserved by each
 * row's qty, and flips the row to EXPIRED. Runs inside the caller's transaction.
 */
export async function releaseExpired(tx: Tx, now: Date = new Date()): Promise<ReleaseResult> {
  const expired = await tx.reservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    select: { id: true, productId: true, baseQty: true },
  });

  for (const r of expired) {
    await tx.$executeRaw`
      UPDATE "ProductStock"
      SET "reserved" = "reserved" - ${r.baseQty}, "updatedAt" = now()
      WHERE "productId" = ${r.productId}`;
    await tx.reservation.update({ where: { id: r.id }, data: { status: "EXPIRED" } });
  }

  return { released: expired.length };
}

// ════════════════════════════════════════════════════════════════════════════
//  S3 — Stock services (GRN / adjustments / returns / suppliers / reports)
//  Built on the kernel above. Each mutation: requirePermission → one
//  prisma.$transaction → signed movement(s) + Batch.onHand upkeep → audit() in
//  the SAME tx (10 §7).
// ════════════════════════════════════════════════════════════════════════════

export interface InventoryCtx {
  session: Session;
  requestId?: string | null;
  /** Idempotency-Key header (GRN is stock-moving → idempotent — 04 §5). */
  idempotencyKey?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

/** A 3dp Prisma Decimal from any decimal-ish value (quantities are @db.Decimal(14,3)). */
function qty3(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(3));
}

interface SaleUnitConv {
  id: string;
  factorToBase: Prisma.Decimal;
  unit: { code: string; kind: "MEASURED" | "PIECE" };
}

/**
 * Load a product's sale unit (for UoM conversion). Throws NOT_FOUND if the sale
 * unit does not belong to the product — guards against cross-product spoofing.
 */
async function loadSaleUnit(tx: Tx, productId: string, saleUnitId: string): Promise<SaleUnitConv> {
  const su = await tx.productSaleUnit.findFirst({
    where: { id: saleUnitId, productId },
    select: { id: true, factorToBase: true, unit: { select: { code: true, kind: true } } },
  });
  if (!su) throw new DomainError(`Sale unit ${saleUnitId} not found for product ${productId}`, "NOT_FOUND");
  return su;
}

/** Convert a receive/sale-unit quantity to a base-unit Prisma Decimal (rejects fractional PIECE). */
function convertToBase(saleQty: string, su: SaleUnitConv): Prisma.Decimal {
  const base = toBaseQty(saleQty, {
    code: su.unit.code,
    kind: su.unit.kind,
    factorToBase: su.factorToBase.toString(),
  });
  return qty3(base);
}

// ─────────────────── pure, DB-free helpers (unit-tested) ───────────────────
/**
 * GRN receive-unit → base conversion + per-base cost. PURE (no DB): exposed so the
 * UoM/cost math is unit-testable without Postgres (the atomic write is the kernel's
 * S8 integration concern). `baseQty = receiveQty × factorToBase` (rejects fractional
 * PIECE via toBaseQty); `costPerBase = costPerReceiveUnit(paise) / factor`, as a
 * rupee Decimal.
 */
export function grnLineBaseAndCost(
  receiveQty: string,
  unit: { code: string; kind: "MEASURED" | "PIECE"; factorToBase: Decimal.Value },
  costPerReceiveUnitPaise: number,
): { baseQty: Prisma.Decimal; costPerBase: Prisma.Decimal } {
  const base = toBaseQty(receiveQty, {
    code: unit.code,
    kind: unit.kind,
    factorToBase: unit.factorToBase.toString(),
  });
  const costPerBase = fromPaise(costPerReceiveUnitPaise).div(new Decimal(unit.factorToBase));
  return {
    baseQty: new Prisma.Decimal(base.toFixed(3)),
    costPerBase: new Prisma.Decimal(costPerBase.toFixed(2)),
  };
}

/**
 * Negative-stock policy decision (03 §5, A5). An OUT movement (adjustment / purchase
 * return) bypasses the availability guard only when the product is flagged
 * allowNegative OR the request explicitly opts in. SALES returns and any IN never
 * consult this (they only add stock). PURE for unit testing.
 */
export function negativeAllowed(productAllowNegative: boolean, requestAllowNegative: boolean): boolean {
  return productAllowNegative || requestAllowNegative;
}

/**
 * Upsert a Batch by (productId, code) and add `baseQtyDelta` (signed) to its
 * onHand, keeping Batch.onHand in parallel with ProductStock.onHand (13 §5).
 * Returns the batch id (for tagging the movement). When `code` is null no batch is
 * tracked and null is returned.
 */
async function upsertBatchOnHand(
  tx: Tx,
  productId: string,
  code: string | null | undefined,
  baseQtyDelta: Prisma.Decimal,
  meta: { mrp?: number | null; expiryDate?: string | null; mfgDate?: string | null } = {},
): Promise<string | null> {
  if (!code) return null;
  const existing = await tx.batch.findUnique({
    where: { productId_code: { productId, code } },
    select: { id: true },
  });
  if (existing) {
    await tx.batch.update({
      where: { id: existing.id },
      data: {
        onHand: { increment: baseQtyDelta },
        ...(meta.mrp != null ? { mrp: fromPaise(meta.mrp) } : {}),
        ...(meta.expiryDate ? { expiryDate: new Date(meta.expiryDate) } : {}),
        ...(meta.mfgDate ? { mfgDate: new Date(meta.mfgDate) } : {}),
      },
    });
    return existing.id;
  }
  const created = await tx.batch.create({
    data: {
      productId,
      code,
      onHand: baseQtyDelta,
      mrp: meta.mrp != null ? fromPaise(meta.mrp) : null,
      expiryDate: meta.expiryDate ? new Date(meta.expiryDate) : null,
      mfgDate: meta.mfgDate ? new Date(meta.mfgDate) : null,
    },
    select: { id: true },
  });
  return created.id;
}

// ─────────────────── GRN (goods-received → stock-in) ───────────────────
export interface GrnLineDTO {
  productId: Id;
  receiveUnitId: Id;
  quantity: string; // in the receive unit
  baseQuantityAdded: string; // converted to base
  batchNo: string | null;
  stockMovementId: Id;
}
export interface GrnDTO {
  id: Id;
  supplierId: Id | null;
  refNo: string | null;
  date: string;
  lines: GrnLineDTO[];
  stockMovementIds: Id[];
  createdAt: string;
}

/**
 * Record a goods-receipt (GRN): create GoodsReceipt + GrnLine rows, convert each
 * line's receive-unit qty → base via toBaseQty, increment ProductStock.onHand via
 * a GRN_IN movement (kernel incrementStock), and upsert an optional Batch with
 * expiry. `costPerReceiveUnit` (paise) is converted to per-base cost and stored on
 * the line. Stock-moving → idempotent on the Idempotency-Key (04 §5): a retry with
 * the same key+body replays the original GRN.
 */
export async function recordGrn(input: RecordGrnInput, ctx: InventoryCtx): Promise<GrnDTO> {
  requirePermission(ctx.session, "stock.grn");
  const data = recordGrnSchema.parse(input);

  const route = "POST /api/grn";
  const requestHash = hashRequest(data);
  if (ctx.idempotencyKey) {
    const { replay } = await findIdempotent<GrnDTO>(
      ctx.idempotencyKey,
      ctx.session.userId,
      route,
      requestHash,
    );
    if (replay) return replay.response;
  }

  try {
    return await runTx(async (tx) => {
      const grn = await tx.goodsReceipt.create({
        data: {
          supplierId: data.supplierId ?? null,
          refNo: data.supplierInvoiceNo ?? null,
          date: data.receivedAt ? new Date(data.receivedAt) : new Date(),
          note: data.note ?? null,
          createdById: ctx.session.userId,
        },
        select: { id: true, supplierId: true, refNo: true, date: true },
      });

      const lineDTOs: GrnLineDTO[] = [];
      const movementIds: string[] = [];

      for (const line of data.lines) {
        const su = await loadSaleUnit(tx, line.productId, line.receiveUnitId);
        // UoM conversion + per-base cost via the pure (unit-tested) helper.
        const { baseQty, costPerBase } = grnLineBaseAndCost(
          line.quantity,
          { code: su.unit.code, kind: su.unit.kind, factorToBase: su.factorToBase },
          line.costPerReceiveUnit,
        );

        const batchId = await upsertBatchOnHand(tx, line.productId, line.batchNo, baseQty, {
          mrp: line.mrp,
          expiryDate: line.expiryDate,
          mfgDate: line.mfgDate,
        });

        // Atomic +stock and signed GRN_IN movement (kernel returns the movement id).
        const movementId = await incrementStock(tx, line.productId, baseQty, "GRN_IN", {
          refType: "GRN",
          refId: grn.id,
          actorStaffId: ctx.session.userId,
          batchId,
        });
        movementIds.push(movementId);

        await tx.grnLine.create({
          data: {
            grnId: grn.id,
            productId: line.productId,
            batchId,
            baseQty,
            costPerBaseUnit: costPerBase,
          },
        });

        lineDTOs.push({
          productId: line.productId,
          receiveUnitId: line.receiveUnitId,
          quantity: line.quantity,
          baseQuantityAdded: baseQty.toString(),
          batchNo: line.batchNo ?? null,
          stockMovementId: movementId,
        });
      }

      const dto: GrnDTO = {
        id: grn.id,
        supplierId: grn.supplierId,
        refNo: grn.refNo,
        date: grn.date.toISOString(),
        lines: lineDTOs,
        stockMovementIds: movementIds,
        createdAt: grn.date.toISOString(),
      };

      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "stock.grn",
        action: "stock.grn",
        targetType: "GoodsReceipt",
        targetId: grn.id,
        after: { lines: data.lines.length, supplierId: data.supplierId ?? null },
        requestId: ctx.requestId,
      });

      if (ctx.idempotencyKey) {
        await storeIdempotent(tx, ctx.idempotencyKey, ctx.session.userId, route, requestHash, dto, 201);
      }
      return dto;
    });
  } catch (e) {
    // Two concurrent first attempts can race on the unique (key, principal, route):
    // the loser's tx rolls back on P2002. Re-read the winner's stored response and
    // replay it, so a double-submit still yields one GRN and the original payload.
    if (
      ctx.idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      (e.meta?.target as string[] | string | undefined)?.toString().includes("key")
    ) {
      const { replay } = await findIdempotent<GrnDTO>(
        ctx.idempotencyKey,
        ctx.session.userId,
        route,
        requestHash,
      );
      if (replay) return replay.response;
    }
    throw e;
  }
}

// ─────────────────── Stock adjustment (signed + reason) ───────────────────
export interface MovementDTO {
  id: Id;
  productId: Id;
  baseQty: string; // signed
  kind: MovementKind;
  refType: string | null;
  refId: string | null;
  reason: string | null;
  batchId: string | null;
  actorStaffId: string | null;
  createdAt: string;
}

function toMovementDTO(m: {
  id: string;
  productId: string;
  baseQty: Prisma.Decimal;
  kind: MovementKind;
  refType: string | null;
  refId: string | null;
  reason: string | null;
  batchId: string | null;
  actorStaffId: string | null;
  createdAt: Date;
}): MovementDTO {
  return {
    id: m.id,
    productId: m.productId,
    baseQty: m.baseQty.toString(),
    kind: m.kind,
    refType: m.refType,
    refId: m.refId,
    reason: m.reason,
    batchId: m.batchId,
    actorStaffId: m.actorStaffId,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Manual stock adjustment (damage / wastage / count / opening stock). Writes a
 * signed ADJUST_IN or ADJUST_OUT movement with a REQUIRED reason (10 §7). OUT
 * respects the negative-stock policy (03 §5, A5): blocked unless the product is
 * flagged allowNegative OR the request opts in. IN always increments. Adjusts
 * Batch.onHand in parallel when a batch is named.
 */
export async function adjustStock(input: AdjustStockInput, ctx: InventoryCtx): Promise<MovementDTO> {
  requirePermission(ctx.session, "stock.adjust");
  const data = adjustStockSchema.parse(input);

  return await runTx(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: data.productId },
      select: { id: true, allowNegative: true },
    });
    if (!product) throw new DomainError(`Product ${data.productId} not found`, "NOT_FOUND");
    const su = await loadSaleUnit(tx, data.productId, data.saleUnitId);
    const baseQty = convertToBase(data.quantity, su);

    let movementId: string;
    if (data.direction === "IN") {
      const batchId = await upsertBatchOnHand(tx, data.productId, data.batchNo, baseQty);
      movementId = await incrementStock(tx, data.productId, baseQty, "ADJUST_IN", {
        refType: "ADJUSTMENT",
        reason: data.reason,
        actorStaffId: ctx.session.userId,
        batchId,
      });
    } else {
      const allowNeg = negativeAllowed(product.allowNegative, data.allowNegative);
      const batchId = await upsertBatchOnHand(tx, data.productId, data.batchNo, baseQty.negated());
      movementId = await decrementStock(
        tx,
        data.productId,
        baseQty,
        "ADJUST_OUT",
        { refType: "ADJUSTMENT", reason: data.reason, actorStaffId: ctx.session.userId, batchId },
        allowNeg,
      );
    }

    const mv = await tx.stockMovement.findUniqueOrThrow({ where: { id: movementId } });

    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "stock.adjust",
      action: "stock.adjust",
      targetType: "Product",
      targetId: data.productId,
      after: { direction: data.direction, baseQty: baseQty.toString(), reason: data.reason },
      requestId: ctx.requestId,
    });

    return toMovementDTO(mv);
  });
}

/**
 * Set a product's on-hand to an absolute value (base units). The operator just
 * types the real count; we record the DIFFERENCE from the current on-hand as a
 * single ADJUST_IN / ADJUST_OUT movement so the ledger and audit stay intact —
 * never a silent overwrite of ProductStock. Returns the movement, or null when
 * the target already equals on-hand (no-op). A downward set bypasses the reserved
 * guard (the operator is asserting the true physical count). Permission:
 * stock.adjust.
 */
export async function setStockLevel(input: SetStockLevelInput, ctx: InventoryCtx): Promise<MovementDTO | null> {
  requirePermission(ctx.session, "stock.adjust");
  const data = setStockLevelSchema.parse(input);
  const target = qty3(data.onHand);
  const reason = data.reason ?? "Manual stock edit";

  return await runTx(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: data.productId },
      select: { id: true },
    });
    if (!product) throw new DomainError(`Product ${data.productId} not found`, "NOT_FOUND");

    const stock = await tx.productStock.findUnique({
      where: { productId: data.productId },
      select: { onHand: true },
    });
    const current = new Decimal(stock ? stock.onHand.toString() : 0);
    const delta = new Decimal(target.toString()).minus(current);
    if (delta.isZero()) return null;

    let movementId: string;
    if (delta.isPositive()) {
      movementId = await incrementStock(tx, data.productId, delta, "ADJUST_IN", {
        refType: "ADJUSTMENT",
        reason,
        actorStaffId: ctx.session.userId,
      });
    } else {
      // Absolute set: always apply, even below reserved (bypass the guard).
      movementId = await decrementStock(
        tx,
        data.productId,
        delta.negated(),
        "ADJUST_OUT",
        { refType: "ADJUSTMENT", reason, actorStaffId: ctx.session.userId },
        true,
      );
    }

    const mv = await tx.stockMovement.findUniqueOrThrow({ where: { id: movementId } });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "stock.adjust",
      action: "stock.setLevel",
      targetType: "Product",
      targetId: data.productId,
      before: { onHand: current.toString() },
      after: { onHand: target.toString(), reason },
      requestId: ctx.requestId,
    });
    return toMovementDTO(mv);
  });
}

// ─────────────────── Returns (sales-return-in / purchase-return-out) ───────────────────
/**
 * Record a return. SALES return → goods come back IN (SALES_RETURN_IN, always
 * allowed); PURCHASE return → goods go back to the supplier OUT
 * (PURCHASE_RETURN_OUT, respects the negative-stock policy). Signed movement +
 * reason + audit in one tx. Permission: stock.returns.
 */
export async function recordReturn(input: RecordReturnInput, ctx: InventoryCtx): Promise<MovementDTO> {
  requirePermission(ctx.session, "stock.returns");
  const data = recordReturnSchema.parse(input);

  return await runTx(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: data.productId },
      select: { id: true, allowNegative: true },
    });
    if (!product) throw new DomainError(`Product ${data.productId} not found`, "NOT_FOUND");
    const su = await loadSaleUnit(tx, data.productId, data.saleUnitId);
    const baseQty = convertToBase(data.quantity, su);

    let movementId: string;
    if (data.kind === "SALES") {
      const batchId = await upsertBatchOnHand(tx, data.productId, data.batchNo, baseQty);
      movementId = await incrementStock(tx, data.productId, baseQty, "SALES_RETURN_IN", {
        refType: "RETURN",
        refId: data.refId ?? null,
        reason: data.reason,
        actorStaffId: ctx.session.userId,
        batchId,
      });
    } else {
      const allowNeg = negativeAllowed(product.allowNegative, data.allowNegative);
      const batchId = await upsertBatchOnHand(tx, data.productId, data.batchNo, baseQty.negated());
      movementId = await decrementStock(
        tx,
        data.productId,
        baseQty,
        "PURCHASE_RETURN_OUT",
        { refType: "RETURN", refId: data.refId ?? null, reason: data.reason, actorStaffId: ctx.session.userId, batchId },
        allowNeg,
      );
    }

    const mv = await tx.stockMovement.findUniqueOrThrow({ where: { id: movementId } });

    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "stock.returns",
      action: "stock.return",
      targetType: "Product",
      targetId: data.productId,
      after: { kind: data.kind, baseQty: baseQty.toString(), reason: data.reason },
      requestId: ctx.requestId,
    });

    return toMovementDTO(mv);
  });
}

// ─────────────────── Stock list / low-stock ───────────────────
export interface StockRowDTO {
  productId: Id;
  sku: string;
  name: string;
  baseUnitCode: string;
  onHand: string;
  reserved: string;
  available: string;
  reorderLevel: string | null;
  lowStock: boolean;
  allowNegative: boolean;
}
export interface StockPage {
  data: StockRowDTO[];
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

/** True when onHand ≤ reorderLevel (and a reorder level is set). */
export function isLowStock(onHand: Prisma.Decimal | string, reorderLevel: Prisma.Decimal | string | null): boolean {
  if (reorderLevel === null) return false;
  return new Prisma.Decimal(onHand).lte(new Prisma.Decimal(reorderLevel));
}

/**
 * On-hand per product (base unit) with a low-stock flag (04 Stock). Cursor-
 * paginated (stable by product id). Filters (optional + additive):
 *  - lowOnly / lowStockOnly — items at/below reorder level (either flag triggers it).
 *  - categoryId — restrict to one category.
 *  - q — name/sku match.
 * Read-only (stock.read enforced at transport).
 */
export async function listStock(query: StockListQuery = {}): Promise<StockPage> {
  const { q, lowOnly, lowStockOnly, categoryId, cursor, limit } = stockListQuerySchema.parse(query);
  const onlyLow = lowOnly || lowStockOnly === true;

  const where: Prisma.ProductWhereInput = { isActive: true };
  if (categoryId) where.categoryId = categoryId;
  if (q && q.length > 0) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
    ];
  }

  const afterId = decodeCursor(cursor);
  const select = {
    id: true,
    sku: true,
    name: true,
    reorderLevel: true,
    allowNegative: true,
    baseUnit: { select: { code: true } },
    stock: { select: { onHand: true, reserved: true } },
  } satisfies Prisma.ProductSelect;

  const toDTO = (p: Prisma.ProductGetPayload<{ select: typeof select }>): StockRowDTO => {
    const onHand = p.stock?.onHand ?? new Prisma.Decimal(0);
    const reserved = p.stock?.reserved ?? new Prisma.Decimal(0);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      baseUnitCode: p.baseUnit.code,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: onHand.minus(reserved).toString(),
      reorderLevel: p.reorderLevel === null ? null : p.reorderLevel.toString(),
      lowStock: isLowStock(onHand, p.reorderLevel),
      allowNegative: p.allowNegative,
    };
  };

  if (!onlyLow) {
    // Normal listing: one page (+1 sentinel for hasNextPage), keyset by product id.
    const rows = await prisma.product.findMany({
      where,
      select,
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const data = pageRows.map(toDTO);
    return {
      data,
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && data.length > 0 ? encodeCursor(data[data.length - 1]!.productId) : null,
      },
    };
  }

  // Low-stock view. The predicate is a column-to-column compare (onHand ≤ reorderLevel)
  // which Prisma's typed API cannot express in SQL, so it is filtered in JS. To stay
  // correct AND paginate properly (the previous code over-fetched a fixed 200-row window
  // and never paginated low-only — under-reporting once the catalog exceeds 200 products),
  // we scan active products in keyset batches by id and keep matches until we have one
  // page (+1 to know if a further page exists), or the catalog is exhausted.
  const SCAN_BATCH = 200;
  const collected: StockRowDTO[] = [];
  let scanCursor = afterId;
  let exhausted = false;
  while (collected.length <= limit && !exhausted) {
    const batch = await prisma.product.findMany({
      where,
      select,
      orderBy: { id: "asc" },
      take: SCAN_BATCH,
      ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
    });
    if (batch.length < SCAN_BATCH) exhausted = true;
    if (batch.length > 0) scanCursor = batch[batch.length - 1]!.id;
    for (const p of batch) {
      const dto = toDTO(p);
      if (dto.lowStock) collected.push(dto);
    }
  }
  const hasNextPage = collected.length > limit;
  const data = collected.slice(0, limit);
  return {
    data,
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage && data.length > 0 ? encodeCursor(data[data.length - 1]!.productId) : null,
    },
  };
}

/** Items at/below reorder level (low-stock alert source — 03 §10 job uses this). */
export async function lowStock(limit = 200): Promise<StockRowDTO[]> {
  // Clamp to the list query's max so a caller-supplied limit never trips Zod (this
  // is an internal alert source, not a wire query).
  const page = await listStock({ lowOnly: true, limit: Math.min(Math.max(limit, 1), 200) });
  return page.data;
}

// ─────────────────── Movement ledger ───────────────────
export interface MovementPage {
  data: MovementDTO[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/**
 * Movement ledger (04 Stock). All movement kinds, including KACHA_OUT which shows
 * as an unattributed stock-out (03 §6). Filter by product / kind / date range
 * (all optional + additive); cursor-paginated by createdAt,id (DESC — newest first).
 */
export async function listMovements(query: MovementsQuery = {}): Promise<MovementPage> {
  const { productId, kind, from, to, cursor, limit } = movementsQuerySchema.parse(query);

  const where: Prisma.StockMovementWhereInput = {};
  if (productId) where.productId = productId;
  if (kind) where.kind = kind;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const afterId = decodeCursor(cursor);
  const rows = await prisma.stockMovement.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    data: pageRows.map(toMovementDTO),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage ? encodeCursor(pageRows[pageRows.length - 1]!.id) : null,
    },
  };
}

// ─────────────────── Near-expiry ───────────────────
export interface NearExpiryDTO {
  batchId: Id;
  productId: Id;
  productName: string;
  sku: string;
  code: string;
  expiryDate: string;
  onHand: string;
  daysToExpiry: number;
}

/**
 * Batches expiring within `withinDays` that still hold stock (onHand > 0), soonest
 * first (04 Stock; 03 §10 near-expiry job source). Includes already-expired
 * batches (daysToExpiry ≤ 0) so they surface for action.
 */
export async function nearExpiry(query: NearExpiryQuery = {}): Promise<NearExpiryDTO[]> {
  const { withinDays } = nearExpiryQuerySchema.parse(query);
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.batch.findMany({
    where: { expiryDate: { not: null, lte: cutoff }, onHand: { gt: 0 } },
    orderBy: { expiryDate: "asc" },
    select: {
      id: true,
      code: true,
      expiryDate: true,
      onHand: true,
      product: { select: { id: true, name: true, sku: true } },
    },
  });

  return rows.map((b) => {
    const expiry = b.expiryDate!;
    const days = Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return {
      batchId: b.id,
      productId: b.product.id,
      productName: b.product.name,
      sku: b.product.sku,
      code: b.code,
      expiryDate: expiry.toISOString(),
      onHand: b.onHand.toString(),
      daysToExpiry: days,
    };
  });
}

// ─────────────────── Suppliers CRUD ───────────────────
export interface SupplierDTO {
  id: Id;
  name: string;
  gstin: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
}
export interface SupplierDuesDTO {
  supplierId: Id;
  /** Total recorded supplier payments (paise). POs are future — no payable computed yet ([N]). */
  paidTotal: number;
  payments: { id: Id; amount: number; mode: string; date: string }[];
}

function toSupplierDTO(s: {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  address: string | null;
  createdAt: Date;
}): SupplierDTO {
  return {
    id: s.id,
    name: s.name,
    gstin: s.gstin,
    phone: s.phone,
    address: s.address,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Supplier directory (suppliers.read enforced at transport). */
export async function listSuppliers(): Promise<SupplierDTO[]> {
  const rows = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  return rows.map(toSupplierDTO);
}

export async function getSupplier(id: Id): Promise<SupplierDTO | null> {
  const s = await prisma.supplier.findUnique({ where: { id } });
  return s ? toSupplierDTO(s) : null;
}

export async function createSupplier(input: UpsertSupplierInput, ctx: InventoryCtx): Promise<SupplierDTO> {
  requirePermission(ctx.session, "suppliers.write");
  const data = upsertSupplierSchema.parse(input);
  const created = await runTx(async (tx) => {
    const s = await tx.supplier.create({
      data: {
        name: data.name,
        gstin: data.gstin ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
      },
    });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "suppliers.write",
      action: "supplier.create",
      targetType: "Supplier",
      targetId: s.id,
      after: { name: s.name },
      requestId: ctx.requestId,
    });
    return s;
  });
  return toSupplierDTO(created);
}

export async function editSupplier(id: Id, input: EditSupplierInput, ctx: InventoryCtx): Promise<SupplierDTO> {
  requirePermission(ctx.session, "suppliers.write");
  const data = editSupplierSchema.parse(input);
  const updated = await runTx(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw new DomainError(`Supplier ${id} not found`, "NOT_FOUND");
    const s = await tx.supplier.update({
      where: { id },
      data: {
        name: data.name,
        gstin: data.gstin === undefined ? undefined : data.gstin,
        phone: data.phone === undefined ? undefined : data.phone,
        address: data.address === undefined ? undefined : data.address,
      },
    });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "suppliers.write",
      action: "supplier.edit",
      targetType: "Supplier",
      targetId: id,
      before: { name: before.name },
      after: { name: s.name },
      requestId: ctx.requestId,
    });
    return s;
  });
  return toSupplierDTO(updated);
}

/** Supplier dues / payments (nice-to-have [N]). POs are future — only payments listed. */
export async function getSupplierDues(id: Id): Promise<SupplierDuesDTO> {
  const payments = await prisma.supplierPayment.findMany({
    where: { supplierId: id },
    orderBy: { date: "desc" },
  });
  const paidTotal = payments.reduce((acc, p) => acc + toPaise(p.amount), 0);
  return {
    supplierId: id,
    paidTotal,
    payments: payments.map((p) => ({
      id: p.id,
      amount: toPaise(p.amount),
      mode: p.mode,
      date: p.date.toISOString(),
    })),
  };
}

// Re-export the inventory Zod surface so transport imports validation from @hardware/core only.
export * from "./schema";
