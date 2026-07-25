// The ONE place catalog/pricing/import input shapes are defined (04 §4). Both the
// server action and the route handler parse with these schemas, and the admin
// form validates the same shape — so business rules can never diverge by entry
// point. Money is integer paise on the wire (04 §2); quantities and conversion
// factors are decimal strings (parsed to Prisma Decimal in the service). PIECE vs
// MEASURED fractional-qty enforcement is a domain rule (uom.toBaseQty), not a Zod
// concern, so it lives in the service.
import { z } from "zod";

/** Money on the wire = non-negative integer paise (04 §2). */
const paise = z.number().int().nonnegative();

/** A decimal-string quantity / factor, validated for shape only (domain checks the unit). */
const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal");

/** A positive decimal-string (factor / minQty must be > 0). */
const positiveDecimalString = decimalString.refine((v) => Number(v) > 0, {
  message: "must be greater than 0",
});

/** GST rate percentage (0–100, up to 2 dp). */
const gstRatePct = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "invalid GST rate")
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, "GST rate must be 0–100");

/**
 * Product image references. We store the Cloudinary delivery URL (or any storage
 * key/URL) verbatim — display is a plain <img>, thumbnails add a Cloudinary
 * transform string-side (see @hardware/core cldThumb). Capped so a form can never
 * bloat a row: at most 8 images, each URL ≤ 2048 chars.
 */
const imageKeys = z.array(z.string().trim().min(1).max(2048)).max(8);

export const saleUnitInputSchema = z.object({
  /** Existing Unit id to attach as a sale unit. */
  unitId: z.string().min(1),
  factorToBase: positiveDecimalString,
  /** Optional MRP per sale unit in paise. */
  mrp: paise.optional().nullable(),
  /** Default sale price per sale unit in paise. */
  salePrice: paise,
  isDefault: z.boolean().optional().default(false),
});
export type SaleUnitInput = z.infer<typeof saleUnitInputSchema>;

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  brandId: z.string().min(1).optional().nullable(),
  categoryId: z.string().min(1),
  hsnCode: z.string().trim().max(12).optional().nullable(),
  baseUnitId: z.string().min(1),
  costPerBaseUnit: paise.default(0),
  gstRatePct,
  priceInclusive: z.boolean().optional().default(false),
  reorderLevel: decimalString.optional().nullable(),
  trackExpiry: z.boolean().optional().default(false),
  allowNegative: z.boolean().optional().default(false),
  availableOnline: z.boolean().optional().default(true),
  /** Cloudinary image URLs (0–8). Optional; defaults to none. */
  imageKeys: imageKeys.optional().default([]),
  /** At least one sale unit; the base unit is usually also a sale unit (factor 1). */
  saleUnits: z.array(saleUnitInputSchema).min(1),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  brandId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).optional(),
  hsnCode: z.string().trim().max(12).nullable().optional(),
  costPerBaseUnit: paise.optional(),
  gstRatePct: gstRatePct.optional(),
  priceInclusive: z.boolean().optional(),
  reorderLevel: decimalString.nullable().optional(),
  trackExpiry: z.boolean().optional(),
  allowNegative: z.boolean().optional(),
  availableOnline: z.boolean().optional(),
  /** Replace the product's image list (omit to leave images unchanged). */
  imageKeys: imageKeys.optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const editSaleUnitSchema = z.object({
  factorToBase: positiveDecimalString.optional(),
  mrp: paise.nullable().optional(),
  salePrice: paise.optional(),
  isDefault: z.boolean().optional(),
});
export type EditSaleUnitInput = z.infer<typeof editSaleUnitSchema>;

/**
 * Product sort orders (storefront + admin product list). `relevance` is the default
 * legacy ordering (stable by id asc — also what cursor pagination is keyed on);
 * price_asc/desc sort by the product's DEFAULT sale-unit price; name_asc is
 * alphabetical; newest is by createdAt desc. NOTE: any sort other than `relevance`
 * disables cursor pagination (see service) — the list returns the first page only.
 */
export const productSortSchema = z.enum([
  "relevance",
  "price_asc",
  "price_desc",
  "name_asc",
  "newest",
]);
export type ProductSort = z.infer<typeof productSortSchema>;

/** Cursor-paginated list query (04 §2). */
export const listProductsQuerySchema = z.object({
  q: z.string().trim().optional(),
  /** @deprecated free-text-ish category match by id — prefer `categoryId`. Kept for existing callers. */
  category: z.string().min(1).optional(),
  /** @deprecated brand match by NAME — prefer `brandId`. Kept for existing callers. */
  brand: z.string().min(1).optional(),
  /** @deprecated boolean in-stock filter — prefer `inStockOnly` (identical behaviour). */
  inStock: z.boolean().optional(),
  /** Filter to a single category by id (additive; ANDs with any legacy `category`). */
  categoryId: z.string().min(1).optional(),
  /** Filter to a single brand by id (additive; ANDs with any legacy `brand` name match). */
  brandId: z.string().min(1).optional(),
  /** Lower price bound in paise (inclusive), matched against any sale unit's salePrice. */
  priceMinPaise: z.number().int().nonnegative().optional(),
  /** Upper price bound in paise (inclusive), matched against any sale unit's salePrice. */
  priceMaxPaise: z.number().int().nonnegative().optional(),
  /** Only products whose live on-hand stock is > 0 (additive; ORs with legacy `inStock`). */
  inStockOnly: z.boolean().optional(),
  /** Result ordering (default `relevance` = stable id asc, cursor-pageable). */
  sort: productSortSchema.optional().default("relevance"),
  /** Include archived (isActive=false) products — staff-only flag; storefront never sets it. */
  includeArchived: z.boolean().optional().default(false),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type ListProductsQuery = z.input<typeof listProductsQuerySchema>;

// ─────────────────── Pricing ───────────────────
export const priceSlabInputSchema = z.object({
  minQty: positiveDecimalString,
  pricePerSaleUnit: paise,
});
export type PriceSlabInput = z.infer<typeof priceSlabInputSchema>;

export const setPriceSlabsSchema = z.object({
  saleUnitId: z.string().min(1),
  slabs: z.array(priceSlabInputSchema),
});
export type SetPriceSlabsInput = z.infer<typeof setPriceSlabsSchema>;

export const editPriceSlabSchema = z.object({
  minQty: positiveDecimalString.optional(),
  pricePerSaleUnit: paise.optional(),
});
export type EditPriceSlabInput = z.infer<typeof editPriceSlabSchema>;

export const resolvePriceQuerySchema = z.object({
  saleUnitId: z.string().min(1),
  qty: positiveDecimalString,
});
export type ResolvePriceQuery = z.infer<typeof resolvePriceQuerySchema>;

// ─────────────────── Masters (category / brand / unit) ───────────────────
export const upsertCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).nullable().optional(),
});
export type UpsertCategoryInput = z.infer<typeof upsertCategorySchema>;

export const upsertBrandSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type UpsertBrandInput = z.infer<typeof upsertBrandSchema>;

export const upsertUnitSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["MEASURED", "PIECE"]),
});
export type UpsertUnitInput = z.infer<typeof upsertUnitSchema>;

// ─────────────────── CSV import ───────────────────
// One catalog-import row. Prices are paise; qty/factor are decimal strings.
// `openingStock` is base-unit on-hand to seed (S2 synchronous; S3 owns real GRN).
export const importRowSchema = z.object({
  sku: z.string().trim().min(1),
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  hsnCode: z.string().trim().optional(),
  gstRatePct,
  baseUnitCode: z.string().trim().min(1),
  baseUnitKind: z.enum(["MEASURED", "PIECE"]).optional(),
  saleUnitCode: z.string().trim().min(1),
  saleUnitKind: z.enum(["MEASURED", "PIECE"]).optional(),
  factorToBase: positiveDecimalString,
  salePrice: paise,
  mrp: paise.optional().nullable(),
  costPerBaseUnit: paise.optional().default(0),
  priceInclusive: z.boolean().optional().default(false),
  openingStock: decimalString.optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;
