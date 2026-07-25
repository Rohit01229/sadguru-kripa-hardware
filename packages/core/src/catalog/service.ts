// Catalog domain service (03 §3, leaf — calls only db). Owns Product + UoM master
// CRUD, cursor-paginated search (pg_trgm — 03 §11), and the storefront-safe field
// projection. Every mutation runs in ONE prisma.$transaction, takes a Session for
// requirePermission, and writes audit() in the SAME tx (10 §7). Money is integer
// paise on the wire (04 §2), converted to/from Prisma Decimal here; the tested
// uom.toBaseQty validates fractional-PIECE quantities. This replaces the
// listProducts → [] stub.
import { Prisma, prisma, runTx, joinStrategy } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toBaseQty } from "../shared/uom";
import { fromPaise, toPaise } from "../shared/money";
import type { Id } from "../shared/types";
import {
  createProductSchema,
  updateProductSchema,
  saleUnitInputSchema,
  editSaleUnitSchema,
  listProductsQuerySchema,
  upsertCategorySchema,
  upsertBrandSchema,
  upsertUnitSchema,
  type CreateProductInput,
  type UpdateProductInput,
  type SaleUnitInput,
  type EditSaleUnitInput,
  type ListProductsQuery,
  type ProductSort,
  type UpsertCategoryInput,
  type UpsertBrandInput,
  type UpsertUnitInput,
} from "./schema";

// ─────────────────── DTOs (typed service output, 04 §1) ───────────────────
export interface SaleUnitDTO {
  id: Id;
  unitId: Id;
  unitCode: string;
  unitName: string;
  unitKind: "MEASURED" | "PIECE";
  factorToBase: string;
  mrp: number | null; // paise
  salePrice: number; // paise
  isDefault: boolean;
}

/** Storefront-safe projection: NO cost, NO supplier, NO internal flags beyond display. */
export interface ProductSummary {
  id: Id;
  sku: string;
  name: string;
  brand: string | null;
  categoryId: Id;
  hsnCode: string | null;
  gstRatePct: string;
  baseUnit: { id: Id; code: string; name: string; kind: "MEASURED" | "PIECE" };
  priceInclusive: boolean;
  saleUnits: SaleUnitDTO[];
  availableBase: string; // live available = onHand − reserved (placeholder until S3 stocks it)
  isActive: boolean;
  availableOnline: boolean;
  imageKeys: string[]; // Cloudinary image URLs (public-safe; empty when none)
}

/** Admin detail adds cost + reorder + negative-stock flags (staff-only). */
export interface ProductDetail extends ProductSummary {
  costPerBaseUnit: number; // paise
  reorderLevel: string | null;
  trackExpiry: boolean;
  allowNegative: boolean;
}

export interface PageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
}
export interface ProductPage {
  data: ProductSummary[];
  pageInfo: PageInfo;
}

// ─────────────────── projection helpers ───────────────────
const productInclude = {
  brand: { select: { name: true } },
  baseUnit: { select: { id: true, code: true, name: true, kind: true } },
  saleUnits: {
    include: { unit: { select: { id: true, code: true, name: true, kind: true } } },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  },
  stock: { select: { onHand: true, reserved: true } },
} satisfies Prisma.ProductInclude;

type ProductWith = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function toSaleUnitDTO(su: ProductWith["saleUnits"][number]): SaleUnitDTO {
  return {
    id: su.id,
    unitId: su.unitId,
    unitCode: su.unit.code,
    unitName: su.unit.name,
    unitKind: su.unit.kind,
    factorToBase: su.factorToBase.toString(),
    mrp: su.mrp === null ? null : toPaise(su.mrp),
    salePrice: toPaise(su.salePrice),
    isDefault: su.isDefault,
  };
}

function toSummary(p: ProductWith): ProductSummary {
  const available = p.stock ? p.stock.onHand.minus(p.stock.reserved) : new Prisma.Decimal(0);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand?.name ?? null,
    categoryId: p.categoryId,
    hsnCode: p.hsnCode,
    gstRatePct: p.gstRate.toString(),
    baseUnit: { id: p.baseUnit.id, code: p.baseUnit.code, name: p.baseUnit.name, kind: p.baseUnit.kind },
    priceInclusive: p.priceInclusive,
    saleUnits: p.saleUnits.map(toSaleUnitDTO),
    availableBase: available.toString(),
    isActive: p.isActive,
    availableOnline: p.availableOnline,
    imageKeys: p.imageKeys ?? [],
  };
}

function toDetail(p: ProductWith): ProductDetail {
  return {
    ...toSummary(p),
    costPerBaseUnit: toPaise(p.costPerBaseUnit),
    reorderLevel: p.reorderLevel === null ? null : p.reorderLevel.toString(),
    trackExpiry: p.trackExpiry,
    allowNegative: p.allowNegative,
  };
}

// ─────────────────── cursor pagination ───────────────────
// Opaque base64 of the product id (stable, sequential cuid ordering by id asc).
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

/**
 * Validate that every sale unit is unique and convert one input row to the Prisma
 * create payload. Throws DomainError("DUP_SALE_UNIT") on a repeated unitId.
 */
function buildSaleUnitData(saleUnits: SaleUnitInput[]): Prisma.ProductSaleUnitCreateWithoutProductInput[] {
  const seen = new Set<string>();
  let defaults = 0;
  const data = saleUnits.map((su) => {
    if (seen.has(su.unitId)) {
      throw new DomainError(`Duplicate sale unit ${su.unitId}`, "DUP_SALE_UNIT");
    }
    seen.add(su.unitId);
    if (su.isDefault) defaults += 1;
    return {
      unit: { connect: { id: su.unitId } },
      factorToBase: new Prisma.Decimal(su.factorToBase),
      mrp: su.mrp === undefined || su.mrp === null ? null : fromPaise(su.mrp),
      salePrice: fromPaise(su.salePrice),
      isDefault: su.isDefault ?? false,
    } satisfies Prisma.ProductSaleUnitCreateWithoutProductInput;
  });
  // Default to the first sale unit if none flagged; reject more than one default.
  if (defaults > 1) throw new DomainError("Only one sale unit may be the default", "MULTI_DEFAULT");
  if (defaults === 0 && data[0]) data[0].isDefault = true;
  return data;
}

// ─────────────────── reads ───────────────────
/**
 * Cursor-paginated product list/search. `q` uses pg_trgm similarity (ILIKE) over
 * name/sku/brand (03 §11). Storefront callers never pass `includeArchived`, so
 * archived products stay hidden.
 *
 * Filters (all optional + additive — omitting one keeps the prior behaviour):
 *  - categoryId / brandId — exact-id filters (preferred). Legacy `category` (id) and
 *    `brand` (NAME) still work and AND with the new ones.
 *  - priceMinPaise / priceMaxPaise — bound on ANY sale unit's salePrice (a product
 *    matches if at least one of its sale units falls in the range; paise on the wire,
 *    Decimal rupees in SQL). NOTE: this is a per-sale-unit, not per-line, filter —
 *    flagged as a business-logic consideration in the report.
 *  - inStockOnly (new) | inStock (legacy) — live on-hand > 0.
 *  - sort — relevance (default, cursor-pageable, stable id asc) | price_asc |
 *    price_desc | name_asc | newest. A non-`relevance` sort orders by a column that is
 *    not the cursor key, so cursor pagination is DISABLED for those sorts (first page
 *    only); `relevance` keeps full cursor pagination unchanged.
 */
export async function listProducts(query: ListProductsQuery = {}): Promise<ProductPage> {
  const {
    q,
    category,
    brand,
    inStock,
    categoryId,
    brandId,
    priceMinPaise,
    priceMaxPaise,
    inStockOnly,
    sort,
    includeArchived,
    cursor,
    limit,
  } = listProductsQuerySchema.parse(query);

  const where: Prisma.ProductWhereInput = {};
  if (!includeArchived) where.isActive = true;
  // Category: legacy `category` (id) and new `categoryId` both narrow to one category.
  if (category) where.categoryId = category;
  if (categoryId) where.categoryId = categoryId;
  // Brand: legacy `brand` matches by NAME; new `brandId` matches by id. Both may apply.
  if (brand) where.brand = { is: { name: brand } };
  if (brandId) where.brandId = brandId;
  // Stock: either flag means "live on-hand > 0". (onHand, not available — matches the
  // existing `inStock` semantics; available = onHand − reserved is the storefront's
  // per-line check at checkout, not this catalog browse filter.)
  if (inStock || inStockOnly) where.stock = { is: { onHand: { gt: 0 } } };
  // Price window: match products having SOME sale unit whose salePrice is in range.
  if (priceMinPaise !== undefined || priceMaxPaise !== undefined) {
    const salePrice: Prisma.DecimalFilter = {};
    if (priceMinPaise !== undefined) salePrice.gte = fromPaise(priceMinPaise);
    if (priceMaxPaise !== undefined) salePrice.lte = fromPaise(priceMaxPaise);
    where.saleUnits = { some: { salePrice } };
  }
  if (q && q.length > 0) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { brand: { is: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }

  // `relevance` keeps the stable id-asc ordering the cursor is encoded against, so
  // cursor pagination is preserved EXACTLY as before. name_asc / newest order by a
  // SQL column; price_asc / price_desc order by the default sale unit's price, which
  // Prisma cannot express as an inline orderBy across the relation, so we sort that
  // page in-memory after load. Any non-`relevance` sort orders by a non-cursor key, so
  // cursor pagination is DISABLED (first page only): nextCursor stays null.
  const cursorable = sort === "relevance";
  const afterId = cursorable ? decodeCursor(cursor) : undefined;
  // Single-JOIN load (when the client supports it) collapses the brand/baseUnit/
  // saleUnits/stock fan-out from N sequential round-trips to one query.
  const rows = await prisma.product.findMany({
    ...(await joinStrategy()),
    where,
    include: productInclude,
    orderBy: productOrderBy(sort),
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  const hasNextPage = rows.length > limit;
  let page = hasNextPage ? rows.slice(0, limit) : rows;
  if (sort === "price_asc" || sort === "price_desc") {
    page = sortByDefaultPrice(page, sort === "price_asc" ? 1 : -1);
  }
  return {
    data: page.map(toSummary),
    pageInfo: {
      hasNextPage,
      nextCursor: cursorable && hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
    },
  };
}

/**
 * Map a sort token to a Prisma orderBy that the DB can satisfy directly. `relevance`
 * (and the price sorts, which are re-sorted in-memory by the default sale-unit price)
 * use the stable id-asc key; name_asc and newest are pure column sorts.
 */
function productOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case "name_asc":
      return { name: "asc" };
    case "newest":
      return { createdAt: "desc" };
    default:
      return { id: "asc" };
  }
}

/**
 * The default sale unit's salePrice (the row `productInclude` orders isDefault-first),
 * as a number for comparison; products with no sale unit sort to the end. PURE.
 */
function defaultSalePrice(p: ProductWith): number {
  const su = p.saleUnits[0];
  return su ? Number(su.salePrice) : Number.POSITIVE_INFINITY;
}

/** Stable in-memory sort of a loaded page by the default sale-unit price (dir: 1 asc, -1 desc). */
function sortByDefaultPrice(rows: ProductWith[], dir: 1 | -1): ProductWith[] {
  return [...rows].sort((a, b) => {
    const d = defaultSalePrice(a) - defaultSalePrice(b);
    return (d !== 0 ? d : a.id.localeCompare(b.id)) * dir;
  });
}

/** Single product (admin detail). Returns null if missing. */
export async function getProduct(id: Id): Promise<ProductDetail | null> {
  const p = await prisma.product.findUnique({
    ...(await joinStrategy()),
    where: { id },
    include: productInclude,
  });
  return p ? toDetail(p) : null;
}

/** Storefront-safe single product (hides archived). Returns null if missing/archived. */
export async function getPublicProduct(id: Id): Promise<ProductSummary | null> {
  const p = await prisma.product.findFirst({
    ...(await joinStrategy()),
    where: { id, isActive: true },
    include: productInclude,
  });
  return p ? toSummary(p) : null;
}

// ─────────────────── mutations ───────────────────
export interface MutationCtx {
  session: Session;
  requestId?: string | null;
}

function auditMeta(session: Session) {
  return {
    actorStaffId: session.userId,
    roleAtTime: session.roles?.[0] ?? null,
  };
}

/**
 * Create a product with a base unit + N sale units (each factorToBase + price +
 * MRP), HSN, GST rate, priceInclusive. One transaction; permission-guarded
 * (products.create) + audited. Creates the ProductStock aggregate row (onHand 0)
 * so the decrement kernel has a row to update (S3/S4). Duplicate SKU → the unique
 * constraint surfaces as DomainError("DUP_SKU").
 */
export async function createProduct(input: CreateProductInput, ctx: MutationCtx): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.create");
  const data = createProductSchema.parse(input);
  const saleUnitData = buildSaleUnitData(data.saleUnits);

  try {
    const created = await runTx(async (tx) => {
      const product = await tx.product.create({
        data: {
          sku: data.sku,
          name: data.name,
          brandId: data.brandId ?? null,
          categoryId: data.categoryId,
          hsnCode: data.hsnCode ?? null,
          baseUnitId: data.baseUnitId,
          costPerBaseUnit: fromPaise(data.costPerBaseUnit),
          gstRate: new Prisma.Decimal(data.gstRatePct),
          priceInclusive: data.priceInclusive ?? false,
          reorderLevel: data.reorderLevel ? new Prisma.Decimal(data.reorderLevel) : null,
          trackExpiry: data.trackExpiry ?? false,
          allowNegative: data.allowNegative ?? false,
          availableOnline: data.availableOnline ?? true,
          imageKeys: data.imageKeys ?? [],
          saleUnits: { create: saleUnitData },
          stock: { create: { onHand: new Prisma.Decimal(0), reserved: new Prisma.Decimal(0) } },
        },
        include: productInclude,
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "products.create",
        action: "products.create",
        targetType: "Product",
        targetId: product.id,
        after: { sku: product.sku, name: product.name },
        requestId: ctx.requestId,
      });
      return product;
    });
    return toDetail(created);
  } catch (e) {
    throw mapPrismaError(e);
  }
}

/** Update product attributes (not sale units — use addSaleUnit/editSaleUnit). */
export async function updateProduct(
  id: Id,
  input: UpdateProductInput,
  ctx: MutationCtx,
): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.update");
  const data = updateProductSchema.parse(input);

  try {
    const updated = await runTx(async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw new DomainError(`Product ${id} not found`, "NOT_FOUND");
      const product = await tx.product.update({
        where: { id },
        data: {
          name: data.name,
          brandId: data.brandId === undefined ? undefined : data.brandId,
          categoryId: data.categoryId,
          hsnCode: data.hsnCode === undefined ? undefined : data.hsnCode,
          costPerBaseUnit: data.costPerBaseUnit === undefined ? undefined : fromPaise(data.costPerBaseUnit),
          gstRate: data.gstRatePct === undefined ? undefined : new Prisma.Decimal(data.gstRatePct),
          priceInclusive: data.priceInclusive,
          reorderLevel:
            data.reorderLevel === undefined
              ? undefined
              : data.reorderLevel === null
                ? null
                : new Prisma.Decimal(data.reorderLevel),
          trackExpiry: data.trackExpiry,
          allowNegative: data.allowNegative,
          availableOnline: data.availableOnline,
          imageKeys: data.imageKeys === undefined ? undefined : data.imageKeys,
        },
        include: productInclude,
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "products.update",
        action: "products.update",
        targetType: "Product",
        targetId: id,
        before: { name: before.name, gstRate: before.gstRate.toString() },
        after: { name: product.name, gstRate: product.gstRate.toString() },
        requestId: ctx.requestId,
      });
      return product;
    });
    return toDetail(updated);
  } catch (e) {
    throw mapPrismaError(e);
  }
}

/**
 * Soft-archive (isActive=false) — NEVER a hard delete (13 conventions, Chunk 3).
 * Archived products vanish from the storefront but the row (and its financial
 * history) is preserved.
 */
export async function archiveProduct(id: Id, ctx: MutationCtx): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.archive");
  try {
    const updated = await runTx(async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw new DomainError(`Product ${id} not found`, "NOT_FOUND");
      const product = await tx.product.update({
        where: { id },
        data: { isActive: false },
        include: productInclude,
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "products.archive",
        action: "products.archive",
        targetType: "Product",
        targetId: id,
        before: { isActive: before.isActive },
        after: { isActive: false },
        requestId: ctx.requestId,
      });
      return product;
    });
    return toDetail(updated);
  } catch (e) {
    throw mapPrismaError(e);
  }
}

/** Restore an archived product (un-archive). products.archive permission. */
export async function unarchiveProduct(id: Id, ctx: MutationCtx): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.archive");
  try {
    const updated = await runTx(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: { isActive: true },
        include: productInclude,
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "products.archive",
        action: "products.unarchive",
        targetType: "Product",
        targetId: id,
        after: { isActive: true },
        requestId: ctx.requestId,
      });
      return product;
    });
    return toDetail(updated);
  } catch (e) {
    throw mapPrismaError(e);
  }
}

/** Add a sale unit to an existing product (products.update). */
export async function addSaleUnit(
  productId: Id,
  input: SaleUnitInput,
  ctx: MutationCtx,
): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.update");
  const data = saleUnitInputSchema.parse(input);
  try {
    const updated = await runTx(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true } });
      if (!product) throw new DomainError(`Product ${productId} not found`, "NOT_FOUND");
      const su = await tx.productSaleUnit.create({
        data: {
          productId,
          unitId: data.unitId,
          factorToBase: new Prisma.Decimal(data.factorToBase),
          mrp: data.mrp === undefined || data.mrp === null ? null : fromPaise(data.mrp),
          salePrice: fromPaise(data.salePrice),
          isDefault: data.isDefault ?? false,
        },
        select: { id: true },
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "products.update",
        action: "products.saleUnit.add",
        targetType: "ProductSaleUnit",
        targetId: su.id,
        after: { productId, unitId: data.unitId },
        requestId: ctx.requestId,
      });
      return tx.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    });
    return toDetail(updated);
  } catch (e) {
    throw mapPrismaError(e);
  }
}

/** Edit a sale unit's factor / price / default flag (products.update). */
export async function editSaleUnit(
  productId: Id,
  saleUnitId: Id,
  input: EditSaleUnitInput,
  ctx: MutationCtx,
): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.update");
  const data = editSaleUnitSchema.parse(input);
  try {
    const updated = await runTx(async (tx) => {
      const before = await tx.productSaleUnit.findFirst({ where: { id: saleUnitId, productId } });
      if (!before) throw new DomainError(`Sale unit ${saleUnitId} not found`, "NOT_FOUND");
      await tx.productSaleUnit.update({
        where: { id: saleUnitId },
        data: {
          factorToBase: data.factorToBase === undefined ? undefined : new Prisma.Decimal(data.factorToBase),
          mrp:
            data.mrp === undefined ? undefined : data.mrp === null ? null : fromPaise(data.mrp),
          salePrice: data.salePrice === undefined ? undefined : fromPaise(data.salePrice),
          isDefault: data.isDefault,
        },
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "products.update",
        action: "products.saleUnit.edit",
        targetType: "ProductSaleUnit",
        targetId: saleUnitId,
        before: { factorToBase: before.factorToBase.toString(), salePrice: before.salePrice.toString() },
        after: { factorToBase: data.factorToBase, salePrice: data.salePrice },
        requestId: ctx.requestId,
      });
      return tx.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    });
    return toDetail(updated);
  } catch (e) {
    throw mapPrismaError(e);
  }
}

// ─────────────────── masters: category / brand / unit ───────────────────
export interface CategoryNode {
  id: Id;
  name: string;
  parentId: Id | null;
  children: CategoryNode[];
}

/** Full category tree (storefront-safe). */
export async function listCategoryTree(): Promise<CategoryNode[]> {
  const rows = await prisma.category.findMany({ orderBy: { name: "asc" } });
  const byId = new Map<string, CategoryNode>();
  for (const c of rows) byId.set(c.id, { id: c.id, name: c.name, parentId: c.parentId, children: [] });
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function createCategory(input: UpsertCategoryInput, ctx: MutationCtx): Promise<CategoryNode> {
  requirePermission(ctx.session, "products.create");
  const data = upsertCategorySchema.parse(input);
  const created = await runTx(async (tx) => {
    const c = await tx.category.create({ data: { name: data.name, parentId: data.parentId ?? null } });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "products.create",
      action: "category.create",
      targetType: "Category",
      targetId: c.id,
      after: { name: c.name },
      requestId: ctx.requestId,
    });
    return c;
  });
  return { id: created.id, name: created.name, parentId: created.parentId, children: [] };
}

export interface BrandDTO {
  id: Id;
  name: string;
}
export async function listBrands(): Promise<BrandDTO[]> {
  return prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}
export async function createBrand(input: UpsertBrandInput, ctx: MutationCtx): Promise<BrandDTO> {
  requirePermission(ctx.session, "products.create");
  const data = upsertBrandSchema.parse(input);
  try {
    const created = await runTx(async (tx) => {
      const b = await tx.brand.create({ data: { name: data.name }, select: { id: true, name: true } });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "products.create",
        action: "brand.create",
        targetType: "Brand",
        targetId: b.id,
        after: { name: b.name },
        requestId: ctx.requestId,
      });
      return b;
    });
    return created;
  } catch (e) {
    throw mapPrismaError(e);
  }
}

export interface UnitDTO {
  id: Id;
  code: string;
  name: string;
  kind: "MEASURED" | "PIECE";
}
/** Master unit list (base + sale unit defs) — 04 Units. */
export async function listUnits(): Promise<UnitDTO[]> {
  return prisma.unit.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, kind: true },
  });
}
export async function createUnit(input: UpsertUnitInput, ctx: MutationCtx): Promise<UnitDTO> {
  requirePermission(ctx.session, "units.manage");
  const data = upsertUnitSchema.parse(input);
  try {
    const created = await runTx(async (tx) => {
      const u = await tx.unit.create({
        data: { code: data.code, name: data.name, kind: data.kind },
        select: { id: true, code: true, name: true, kind: true },
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "units.manage",
        action: "unit.create",
        targetType: "Unit",
        targetId: u.id,
        after: { code: u.code, kind: u.kind },
        requestId: ctx.requestId,
      });
      return u;
    });
    return created;
  } catch (e) {
    throw mapPrismaError(e);
  }
}

// ─────────────────── shared helpers (also used by import) ───────────────────
/**
 * Validate a sale-line quantity against its unit kind via the tested
 * uom.toBaseQty (rejects fractional PIECE — Chunk 6 acceptance). Returns the base
 * quantity as a Prisma Decimal. Exposed so import/billing reuse one rule.
 */
export function validateQtyToBase(
  saleQty: string,
  unit: { code: string; kind: "MEASURED" | "PIECE"; factorToBase: Prisma.Decimal | string },
): Prisma.Decimal {
  const base = toBaseQty(saleQty, {
    code: unit.code,
    kind: unit.kind,
    factorToBase: unit.factorToBase.toString(),
  });
  return new Prisma.Decimal(base.toFixed(3));
}

/** Map Prisma's unique/FK errors to a stable DomainError for transport (04 §2 codes). */
function mapPrismaError(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const target = (e.meta?.target as string[] | string | undefined)?.toString() ?? "";
      if (target.includes("sku")) return new DomainError("SKU already exists", "DUP_SKU");
      if (target.includes("code")) return new DomainError("Unit code already exists", "DUP_UNIT_CODE");
      if (target.includes("name")) return new DomainError("Name already exists", "DUP_NAME");
      if (target.includes("productId") && target.includes("unitId"))
        return new DomainError("Sale unit already exists for this product", "DUP_SALE_UNIT");
      return new DomainError("Duplicate value", "DUPLICATE");
    }
    if (e.code === "P2003") return new DomainError("Referenced record not found", "FK_VIOLATION");
    if (e.code === "P2025") return new DomainError("Record not found", "NOT_FOUND");
  }
  return e;
}

// Re-export schemas/types so transport imports validation from @hardware/core only.
export * from "./schema";
