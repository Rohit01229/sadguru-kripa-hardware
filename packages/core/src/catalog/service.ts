// Catalog domain service (03 §3, leaf — calls only db). Owns Product + UoM master
// CRUD, cursor-paginated search (pg_trgm — 03 §11), and the storefront-safe field
// projection. Every mutation runs in ONE prisma.$transaction, takes a Session for
// requirePermission, and writes audit() in the SAME tx (10 §7). Money is integer
// paise on the wire (04 §2), converted to/from Prisma Decimal here; the tested
// uom.toBaseQty validates fractional-PIECE quantities. This replaces the
// listProducts → [] stub.
import { Prisma, prisma, runTx, joinStrategy, type Tx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toBaseQty } from "../shared/uom";
import { fromPaise, toPaise } from "../shared/money";
import type { Id } from "../shared/types";
// Opening stock goes through the inventory kernel so it lands as a real signed
// movement, never a silent ProductStock write. No import cycle: inventory/service
// imports only shared/* + its own schema (the same direction import/service already
// takes when it seeds CSV opening stock).
import { incrementStock } from "../inventory/service";
import { ensureDefaultMasters } from "./defaults";
import { assertWithinPlan } from "../platform/billing";
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
  /** Scanned EAN/UPC or shop-printed label. Lets the till resolve a scan to an item. */
  barcode: string | null;
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
    barcode: p.barcode,
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
function buildSaleUnitData(
  saleUnits: SaleUnitInput[],
  shopId: string,
): Prisma.ProductSaleUnitCreateWithoutProductInput[] {
  const seen = new Set<string>();
  let defaults = 0;
  const data = saleUnits.map((su) => {
    if (seen.has(su.unitId)) {
      throw new DomainError(`Duplicate sale unit ${su.unitId}`, "DUP_SALE_UNIT");
    }
    seen.add(su.unitId);
    if (su.isDefault) defaults += 1;
    return {
      shopId,
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

// ─────────────────── auto-SKU ───────────────────
/** How many times a create retries when its AUTO-generated SKU loses a race. */
const AUTO_SKU_ATTEMPTS = 5;

/**
 * Name → SKU prefix: alphanumerics only, upper-cased, at most 6 characters
 * ("UltraTech PPC Cement" → "ULTRAT"). Falls back to "ITEM" when the name yields
 * nothing usable (e.g. a Devanagari-only name). PURE — exported so the admin form can
 * preview the SKU it is about to get.
 */
export function skuPrefix(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.length > 0 ? cleaned.slice(0, 6) : "ITEM";
}

/**
 * The next free `PREFIX-0001`-style SKU for this shop, so "add item" never asks the
 * shopkeeper for a code (myBillBook parity). Scans the prefix's existing SKUs and
 * takes the LOWEST unused sequence, so re-adding after an archive reuses the gap.
 *
 * Uniqueness is ultimately enforced by `@@unique([shopId, sku])`; two concurrent
 * creates can still pick the same number, so `createProduct` retries on that P2002
 * (see AUTO_SKU_ATTEMPTS). Runs on the caller's `tx`.
 */
export async function generateSku(tx: Tx, shopId: string, name: string): Promise<string> {
  const prefix = skuPrefix(name);
  const rows = await tx.product.findMany({
    where: { shopId, sku: { startsWith: `${prefix}-` } },
    select: { sku: true },
  });
  const taken = new Set<number>();
  for (const r of rows) {
    const seq = Number(r.sku.slice(prefix.length + 1));
    if (Number.isInteger(seq) && seq > 0) taken.add(seq);
  }
  let next = 1;
  while (taken.has(next)) next += 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

/** True when this error is the (shopId, sku) unique violation — the auto-SKU race. */
function isDuplicateSku(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    ((e.meta?.target as string[] | string | undefined)?.toString() ?? "").includes("sku")
  );
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
export async function listProducts(shopId: string, query: ListProductsQuery = {}): Promise<ProductPage> {
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

  const where: Prisma.ProductWhereInput = { shopId };
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
      // Barcode is matched EXACTLY, not by `contains` (19 §4): a scanner delivers the
      // whole code, and a substring match on a 13-digit EAN would pull in unrelated
      // items that merely share a run of digits.
      { barcode: q },
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
export async function getProduct(shopId: string, id: Id): Promise<ProductDetail | null> {
  const p = await prisma.product.findFirst({
    ...(await joinStrategy()),
    where: { id, shopId },
    include: productInclude,
  });
  return p ? toDetail(p) : null;
}

/** Storefront-safe single product (hides archived). Returns null if missing/archived. */
export async function getPublicProduct(shopId: string, id: Id): Promise<ProductSummary | null> {
  const p = await prisma.product.findFirst({
    ...(await joinStrategy()),
    where: { id, shopId, isActive: true },
    include: productInclude,
  });
  return p ? toSummary(p) : null;
}

/**
 * The GST rate of the shop's most recently created product, as a plain string
 * ("18"), or null when the catalog is empty. The quick-add form pre-fills its GST
 * field with this so the rate is "remembered" between items — a shop usually sells
 * one or two slabs, and re-picking 18% for every item is the kind of friction
 * myBillBook does not have.
 */
export async function getLastUsedGstRate(shopId: string): Promise<string | null> {
  const last = await prisma.product.findFirst({
    where: { shopId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { gstRate: true },
  });
  return last ? last.gstRate.toString() : null;
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
 * Create a product. One transaction; permission-guarded (products.create) + audited.
 * Creates the ProductStock aggregate row (onHand 0) so the decrement kernel has a row
 * to update (S3/S4). Duplicate SKU → DomainError("DUP_SKU").
 *
 * SIMPLE mode (myBillBook parity — name + price is enough) fills in everything the
 * quick-add form does not ask for, IN THIS ORDER, inside the one transaction:
 *   1. permission + shop (unchanged);
 *   2. missing `categoryId` / `baseUnitId` → the shop's defaults, seeding the starter
 *      masters on first use (./defaults ensureDefaultMasters);
 *   3. missing `sku` → the next free `PREFIX-0001` for this shop (generateSku),
 *      retried on the unique-constraint race;
 *   4. empty `saleUnits` → ONE synthesised sale unit at the base unit, factor 1,
 *      priced at the top-level `salePrice` (which becomes required in this mode);
 *   5. `openingStock` (base units) → a real ADJUST_IN movement via the inventory
 *      kernel, so on-hand is never written behind the movement ledger's back;
 *   6. `wholesalePrice` + `wholesaleMinQty` → ONE PriceSlab on the default sale unit,
 *      which the existing pricing resolver applies once a bill line crosses the qty.
 *
 * FULL mode (explicit sku/category/base unit + N sale units) is untouched: every old
 * field is still accepted and behaves exactly as before.
 */
export async function createProduct(input: CreateProductInput, ctx: MutationCtx): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.create");
  const shopId = requireShop(ctx.session);
  // Plan ceiling (16 §8 P4). Refuses the NEXT item with a clear message; never
  // interrupts something already in progress.
  await assertWithinPlan(shopId, "products");
  const data = createProductSchema.parse(input);

  const autoSku = !data.sku;
  const autoCategory = !data.categoryId;
  const autoBaseUnit = !data.baseUnitId;
  // Wholesale needs BOTH halves to mean anything; a lone one is ignored, never an
  // error — the simple path stays forgiving (a slab with no qty, or a qty with no
  // price, is not a rule anyone can bill against).
  const wholesale =
    data.wholesalePrice !== undefined && data.wholesaleMinQty !== undefined && Number(data.wholesaleMinQty) > 0
      ? { minQty: data.wholesaleMinQty, pricePerSaleUnit: data.wholesalePrice }
      : null;

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await runTx(async (tx) => {
        // (2) Back-fill the masters the quick-add form never shows.
        const fallback = autoCategory || autoBaseUnit ? await ensureDefaultMasters(tx, shopId) : null;
        const categoryId = data.categoryId ?? fallback!.defaultCategoryId;
        const baseUnitId = data.baseUnitId ?? fallback!.defaultUnitId;

        // (3) SKU — caller's, or the next free one for this shop.
        const sku = data.sku ?? (await generateSku(tx, shopId, data.name));

        // (4) SIMPLE mode: one sale unit == the base unit, at `salePrice`.
        let saleUnits = data.saleUnits;
        if (saleUnits.length === 0) {
          if (data.salePrice === undefined) throw new DomainError("Enter a sale price.", "VALIDATION");
          saleUnits = [{ unitId: baseUnitId, factorToBase: "1", salePrice: data.salePrice, isDefault: true }];
        }
        const saleUnitData = buildSaleUnitData(saleUnits, shopId);

        const product = await tx.product.create({
          data: {
            shopId,
            sku,
            name: data.name,
            brandId: data.brandId ?? null,
            categoryId,
            hsnCode: data.hsnCode ?? null,
            barcode: data.barcode ?? null,
            baseUnitId,
            costPerBaseUnit: fromPaise(data.costPerBaseUnit),
            gstRate: new Prisma.Decimal(data.gstRatePct),
            priceInclusive: data.priceInclusive ?? false,
            reorderLevel: data.reorderLevel ? new Prisma.Decimal(data.reorderLevel) : null,
            trackExpiry: data.trackExpiry ?? false,
            allowNegative: data.allowNegative ?? false,
            availableOnline: data.availableOnline ?? true,
            imageKeys: data.imageKeys ?? [],
            saleUnits: { create: saleUnitData },
            stock: { create: { shopId, onHand: new Prisma.Decimal(0), reserved: new Prisma.Decimal(0) } },
          },
          include: productInclude,
        });

        // (6) Wholesale rate = one bulk slab on the DEFAULT sale unit (productInclude
        // orders isDefault first, and buildSaleUnitData guarantees exactly one default).
        const defaultSaleUnit = product.saleUnits[0];
        if (wholesale && defaultSaleUnit) {
          await tx.priceSlab.create({
            data: {
              shopId,
              saleUnitId: defaultSaleUnit.id,
              minQty: new Prisma.Decimal(wholesale.minQty),
              pricePerSaleUnit: fromPaise(wholesale.pricePerSaleUnit),
            },
          });
        }

        // (5) Opening stock, in BASE units, validated against the base unit's kind
        // (a PIECE base unit rejects "1.5") and applied through the kernel.
        const seedStock = data.openingStock !== undefined && Number(data.openingStock) > 0;
        if (seedStock) {
          const baseQty = validateQtyToBase(data.openingStock!, {
            code: product.baseUnit.code,
            kind: product.baseUnit.kind,
            factorToBase: "1",
          });
          await incrementStock(tx, shopId, product.id, baseQty, "ADJUST_IN", {
            refType: "ADJUSTMENT",
            reason: "Opening stock",
            actorStaffId: ctx.session.userId,
          });
        }

        await audit(tx, {
          ...auditMeta(ctx.session),
          shopId,
          permissionUsed: "products.create",
          action: "products.create",
          targetType: "Product",
          targetId: product.id,
          after: {
            sku: product.sku,
            name: product.name,
            // What the server filled in for the shopkeeper (quick-add traceability).
            autoSku,
            autoCategory,
            autoBaseUnit,
            openingStock: seedStock ? data.openingStock : null,
            wholesale: wholesale
              ? { minQty: wholesale.minQty, pricePerSaleUnit: wholesale.pricePerSaleUnit }
              : null,
          },
          requestId: ctx.requestId,
        });

        // The row loaded above still carries the pre-seed stock snapshot, so re-read
        // once when we moved stock — otherwise availableBase would report 0.
        return seedStock
          ? tx.product.findUniqueOrThrow({ where: { id: product.id }, include: productInclude })
          : product;
      });
      return toDetail(created);
    } catch (e) {
      // Auto-SKU race: another create took the number we picked. The tx rolled back,
      // so re-running re-scans and picks the next free one.
      if (autoSku && attempt < AUTO_SKU_ATTEMPTS && isDuplicateSku(e)) continue;
      throw mapPrismaError(e);
    }
  }
}

/** Update product attributes (not sale units — use addSaleUnit/editSaleUnit). */
export async function updateProduct(
  id: Id,
  input: UpdateProductInput,
  ctx: MutationCtx,
): Promise<ProductDetail> {
  requirePermission(ctx.session, "products.update");
  const shopId = requireShop(ctx.session);
  const data = updateProductSchema.parse(input);

  try {
    const updated = await runTx(async (tx) => {
      const before = await tx.product.findFirst({ where: { id, shopId } });
      if (!before) throw new DomainError(`Product ${id} not found`, "NOT_FOUND");
      const product = await tx.product.update({
        where: { id },
        data: {
          name: data.name,
          brandId: data.brandId === undefined ? undefined : data.brandId,
          categoryId: data.categoryId,
          hsnCode: data.hsnCode === undefined ? undefined : data.hsnCode,
          barcode: data.barcode === undefined ? undefined : data.barcode,
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
        shopId,
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
  const shopId = requireShop(ctx.session);
  try {
    const updated = await runTx(async (tx) => {
      const before = await tx.product.findFirst({ where: { id, shopId } });
      if (!before) throw new DomainError(`Product ${id} not found`, "NOT_FOUND");
      const product = await tx.product.update({
        where: { id },
        data: { isActive: false },
        include: productInclude,
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        shopId,
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
  const shopId = requireShop(ctx.session);
  try {
    const updated = await runTx(async (tx) => {
      const before = await tx.product.findFirst({ where: { id, shopId } });
      if (!before) throw new DomainError(`Product ${id} not found`, "NOT_FOUND");
      const product = await tx.product.update({
        where: { id },
        data: { isActive: true },
        include: productInclude,
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        shopId,
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
  const shopId = requireShop(ctx.session);
  const data = saleUnitInputSchema.parse(input);
  try {
    const updated = await runTx(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, shopId }, select: { id: true } });
      if (!product) throw new DomainError(`Product ${productId} not found`, "NOT_FOUND");
      const su = await tx.productSaleUnit.create({
        data: {
          shopId,
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
        shopId,
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
  const shopId = requireShop(ctx.session);
  const data = editSaleUnitSchema.parse(input);
  try {
    const updated = await runTx(async (tx) => {
      const before = await tx.productSaleUnit.findFirst({ where: { id: saleUnitId, productId, shopId } });
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
        shopId,
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
export async function listCategoryTree(shopId: string): Promise<CategoryNode[]> {
  const rows = await prisma.category.findMany({ where: { shopId }, orderBy: { name: "asc" } });
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
  const shopId = requireShop(ctx.session);
  const data = upsertCategorySchema.parse(input);
  const created = await runTx(async (tx) => {
    const c = await tx.category.create({ data: { shopId, name: data.name, parentId: data.parentId ?? null } });
    await audit(tx, {
      ...auditMeta(ctx.session),
      shopId,
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
export async function listBrands(shopId: string): Promise<BrandDTO[]> {
  return prisma.brand.findMany({ where: { shopId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
export async function createBrand(input: UpsertBrandInput, ctx: MutationCtx): Promise<BrandDTO> {
  requirePermission(ctx.session, "products.create");
  const shopId = requireShop(ctx.session);
  const data = upsertBrandSchema.parse(input);
  try {
    const created = await runTx(async (tx) => {
      const b = await tx.brand.create({ data: { shopId, name: data.name }, select: { id: true, name: true } });
      await audit(tx, {
        ...auditMeta(ctx.session),
        shopId,
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
export async function listUnits(shopId: string): Promise<UnitDTO[]> {
  return prisma.unit.findMany({
    where: { shopId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, kind: true },
  });
}
export async function createUnit(input: UpsertUnitInput, ctx: MutationCtx): Promise<UnitDTO> {
  requirePermission(ctx.session, "units.manage");
  const shopId = requireShop(ctx.session);
  const data = upsertUnitSchema.parse(input);
  try {
    const created = await runTx(async (tx) => {
      const u = await tx.unit.create({
        data: { shopId, code: data.code, name: data.name, kind: data.kind },
        select: { id: true, code: true, name: true, kind: true },
      });
      await audit(tx, {
        ...auditMeta(ctx.session),
        shopId,
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
