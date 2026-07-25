// Pricing domain service (03 §3 — may call catalog, never writes stock/invoices).
// Quantity-break slabs attach to a ProductSaleUnit; the effective price for a
// (product, saleUnit, qty) is the slab with the greatest minQty ≤ qty, else the
// sale unit's default salePrice. Slabs are universal — visible to storefront AND
// counter (02 Decision 5: B2B = universal bulk slabs, no customer-specific lists).
// Money is integer paise on the wire (04 §2); slab math is exact Prisma Decimal.
import { Prisma, prisma, runTx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise, fromPaise } from "../shared/money";
import type { Id } from "../shared/types";
import {
  setPriceSlabsSchema,
  editPriceSlabSchema,
  resolvePriceQuerySchema,
  type SetPriceSlabsInput,
  type EditPriceSlabInput,
} from "../catalog/schema";

export interface PriceSlabDTO {
  id: Id;
  saleUnitId: Id;
  minQty: string;
  pricePerSaleUnit: number; // paise
}

export interface ResolvedPrice {
  saleUnitId: Id;
  qty: string;
  /** Effective per-sale-unit price in paise after applying the best slab. */
  unitPrice: number;
  /** Line total = unitPrice × qty (paise, rounded to paise). */
  lineTotal: number;
  /** The matched slab (null when the default salePrice applies). */
  matchedSlabMinQty: string | null;
}

interface MutationCtx {
  session: Session;
  requestId?: string | null;
}

export interface SlabRow {
  minQty: Prisma.Decimal | string;
  pricePerSaleUnit: Prisma.Decimal | string;
}

/**
 * Pure slab resolution (testable without the DB): from a sale unit's default
 * price and its slabs, return the effective per-sale-unit price for `qty` — the
 * slab with the greatest minQty ≤ qty, else the default. Exposed for unit tests
 * and reuse; `resolvePrice` does the same selection via an indexed query.
 */
export function pickSlabPrice(
  defaultPrice: Prisma.Decimal | string,
  slabs: SlabRow[],
  qty: Prisma.Decimal | string,
): { unitPrice: Prisma.Decimal; matchedSlabMinQty: string | null } {
  const q = new Prisma.Decimal(qty);
  let best: SlabRow | null = null;
  for (const s of slabs) {
    const min = new Prisma.Decimal(s.minQty);
    if (min.lte(q)) {
      if (!best || new Prisma.Decimal(best.minQty).lt(min)) best = s;
    }
  }
  if (best) {
    return {
      unitPrice: new Prisma.Decimal(best.pricePerSaleUnit),
      matchedSlabMinQty: new Prisma.Decimal(best.minQty).toString(),
    };
  }
  return { unitPrice: new Prisma.Decimal(defaultPrice), matchedSlabMinQty: null };
}

/**
 * Resolve the effective price for `qty` of a sale unit (03 §4 — slabs resolved by
 * the Pricing service). Walks slabs by minQty DESC and picks the first whose
 * minQty ≤ qty; falls back to the sale unit's default salePrice when none match.
 * Read-only and public (slabs visible to all).
 */
export async function resolvePrice(productId: Id, query: { saleUnitId: string; qty: string }): Promise<ResolvedPrice> {
  const { saleUnitId, qty } = resolvePriceQuerySchema.parse(query);

  const saleUnit = await prisma.productSaleUnit.findFirst({
    where: { id: saleUnitId, productId },
    select: { id: true, salePrice: true },
  });
  if (!saleUnit) throw new DomainError(`Sale unit ${saleUnitId} not found for product ${productId}`, "NOT_FOUND");

  const qtyDec = new Prisma.Decimal(qty);

  // Best slab = greatest minQty that is ≤ qty (one indexed query, ordered desc).
  const slab = await prisma.priceSlab.findFirst({
    where: { saleUnitId, minQty: { lte: qtyDec } },
    orderBy: { minQty: "desc" },
    select: { minQty: true, pricePerSaleUnit: true },
  });

  const unitPriceDec = slab ? slab.pricePerSaleUnit : saleUnit.salePrice;
  const lineTotalDec = unitPriceDec.times(qtyDec);

  return {
    saleUnitId,
    qty,
    unitPrice: toPaise(unitPriceDec),
    lineTotal: toPaise(lineTotalDec),
    matchedSlabMinQty: slab ? slab.minQty.toString() : null,
  };
}

/** List slabs for a sale unit (admin editor + storefront display). */
export async function listPriceSlabs(saleUnitId: Id): Promise<PriceSlabDTO[]> {
  const rows = await prisma.priceSlab.findMany({
    where: { saleUnitId },
    orderBy: { minQty: "asc" },
    select: { id: true, saleUnitId: true, minQty: true, pricePerSaleUnit: true },
  });
  return rows.map((s) => ({
    id: s.id,
    saleUnitId: s.saleUnitId,
    minQty: s.minQty.toString(),
    pricePerSaleUnit: toPaise(s.pricePerSaleUnit),
  }));
}

/**
 * Replace the full slab set for a sale unit in one transaction (pricing.write +
 * audit). Deletes existing slabs then re-creates from input — simplest correct
 * "save the editor" semantics. Rejects duplicate minQty values.
 */
export async function setPriceSlabs(
  productId: Id,
  input: SetPriceSlabsInput,
  ctx: MutationCtx,
): Promise<PriceSlabDTO[]> {
  requirePermission(ctx.session, "pricing.write");
  const data = setPriceSlabsSchema.parse(input);

  const minQtys = new Set<string>();
  for (const s of data.slabs) {
    if (minQtys.has(s.minQty)) throw new DomainError(`Duplicate slab minQty ${s.minQty}`, "DUP_SLAB");
    minQtys.add(s.minQty);
  }

  await runTx(async (tx) => {
    const su = await tx.productSaleUnit.findFirst({
      where: { id: data.saleUnitId, productId },
      select: { id: true },
    });
    if (!su) throw new DomainError(`Sale unit ${data.saleUnitId} not found for product ${productId}`, "NOT_FOUND");

    await tx.priceSlab.deleteMany({ where: { saleUnitId: data.saleUnitId } });
    if (data.slabs.length > 0) {
      await tx.priceSlab.createMany({
        data: data.slabs.map((s) => ({
          saleUnitId: data.saleUnitId,
          minQty: new Prisma.Decimal(s.minQty),
          pricePerSaleUnit: fromPaise(s.pricePerSaleUnit),
        })),
      });
    }
    await audit(tx, {
      actorStaffId: ctx.session.userId,
      roleAtTime: ctx.session.roles?.[0] ?? null,
      permissionUsed: "pricing.write",
      action: "pricing.slabs.set",
      targetType: "ProductSaleUnit",
      targetId: data.saleUnitId,
      after: { count: data.slabs.length },
      requestId: ctx.requestId,
    });
  });

  return listPriceSlabs(data.saleUnitId);
}

/** Edit a single slab's minQty / price (pricing.write + audit). */
export async function editPriceSlab(
  slabId: Id,
  input: EditPriceSlabInput,
  ctx: MutationCtx,
): Promise<PriceSlabDTO> {
  requirePermission(ctx.session, "pricing.write");
  const data = editPriceSlabSchema.parse(input);

  const updated = await runTx(async (tx) => {
    const before = await tx.priceSlab.findUnique({ where: { id: slabId } });
    if (!before) throw new DomainError(`Slab ${slabId} not found`, "NOT_FOUND");
    const row = await tx.priceSlab.update({
      where: { id: slabId },
      data: {
        minQty: data.minQty === undefined ? undefined : new Prisma.Decimal(data.minQty),
        pricePerSaleUnit:
          data.pricePerSaleUnit === undefined ? undefined : fromPaise(data.pricePerSaleUnit),
      },
      select: { id: true, saleUnitId: true, minQty: true, pricePerSaleUnit: true },
    });
    await audit(tx, {
      actorStaffId: ctx.session.userId,
      roleAtTime: ctx.session.roles?.[0] ?? null,
      permissionUsed: "pricing.write",
      action: "pricing.slab.edit",
      targetType: "PriceSlab",
      targetId: slabId,
      before: { minQty: before.minQty.toString(), pricePerSaleUnit: before.pricePerSaleUnit.toString() },
      after: { minQty: data.minQty, pricePerSaleUnit: data.pricePerSaleUnit },
      requestId: ctx.requestId,
    });
    return row;
  });

  return {
    id: updated.id,
    saleUnitId: updated.saleUnitId,
    minQty: updated.minQty.toString(),
    pricePerSaleUnit: toPaise(updated.pricePerSaleUnit),
  };
}
