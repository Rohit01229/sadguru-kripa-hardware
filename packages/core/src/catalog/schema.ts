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

/**
 * Create a product. Two entry modes share ONE schema (myBillBook-simple parity):
 *
 *  - SIMPLE — name + `salePrice` (+ the pre-filled `gstRatePct`) is enough. `sku`,
 *    `categoryId` and `baseUnitId` are optional and the service fills them: an
 *    auto-generated per-shop SKU, and the shop's default category/unit (seeded on
 *    demand — see ./defaults). An empty `saleUnits` makes the service synthesise one
 *    sale unit at the base unit, factor 1, priced at `salePrice`.
 *  - FULL — the original shape (explicit sku/category/base unit + N sale units) still
 *    parses and behaves EXACTLY as before; nothing was removed, only relaxed.
 *
 * `gstRatePct` stays required: the form always sends it, pre-filled from the shop's
 * last-used rate (see catalog service `getLastUsedGstRate`).
 */
export const createProductSchema = z.object({
  /** Omit to auto-generate a per-shop SKU from the name (e.g. "ULTRAT-0001"). */
  sku: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200),
  brandId: z.string().min(1).optional().nullable(),
  /** Omit to use the shop's default ("General") category. */
  categoryId: z.string().min(1).optional(),
  hsnCode: z.string().trim().max(12).optional().nullable(),
  /** Scanned EAN/UPC or a shop-printed label. Not unique — two items may share one. */
  barcode: z.string().trim().max(64).optional().nullable(),
  /** Omit to use the shop's default unit (PCS). */
  baseUnitId: z.string().min(1).optional(),
  costPerBaseUnit: paise.default(0),
  gstRatePct,
  priceInclusive: z.boolean().optional().default(false),
  reorderLevel: decimalString.optional().nullable(),
  trackExpiry: z.boolean().optional().default(false),
  allowNegative: z.boolean().optional().default(false),
  availableOnline: z.boolean().optional().default(true),
  /** Cloudinary image URLs (0–8). Optional; defaults to none. */
  imageKeys: imageKeys.optional().default([]),
  /**
   * SIMPLE-mode price (paise) for the single auto-created sale unit. Required by the
   * SERVICE (not by Zod) when `saleUnits` is empty — Zod cannot express "one of these
   * two" without breaking the FULL-mode callers that never send it.
   */
  salePrice: paise.optional(),
  /** Opening on-hand in BASE units, seeded as an ADJUST_IN movement on create. */
  openingStock: decimalString.optional(),
  /**
   * Bulk/wholesale rate (paise per sale unit) that replaces `salePrice` once the billed
   * quantity reaches `wholesaleMinQty`. Stored as ONE PriceSlab on the default sale
   * unit, so the existing (tested) pricing resolver applies it at billing time with no
   * billing change. Both fields must be present — a lone one is ignored, never an error.
   */
  wholesalePrice: paise.optional(),
  /** Quantity (in the default sale unit) at/above which `wholesalePrice` applies. */
  wholesaleMinQty: decimalString.optional(),
  /** Sale units (factor + price + MRP each). Omit for SIMPLE mode — see `salePrice`. */
  saleUnits: z.array(saleUnitInputSchema).optional().default([]),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  brandId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).optional(),
  hsnCode: z.string().trim().max(12).nullable().optional(),
  /** Scanned EAN/UPC or a shop-printed label (null clears it). */
  barcode: z.string().trim().max(64).nullable().optional(),
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
/**
 * Money AS TYPED IN A SPREADSHEET. Import is the one boundary where the paise-on-the-
 * wire rule (04 §2) actively hurts: a shopkeeper exporting from Excel/Tally has a
 * column of rupees ("250", "250.50", "₹1,250"), and asking them to multiply every cell
 * by 100 was the single most spreadsheet-hostile thing about the old importer.
 * So: accept rupees here and convert to paise once, at the edge.
 */
const rupeesToPaise = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const cleaned = String(v).replace(/[₹,\s]/g, "").trim();
    if (cleaned === "") return undefined;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a non-negative amount in rupees" });
      return z.NEVER;
    }
    // Round rather than truncate: 0.1+0.2 style float error must not lose a paisa.
    return Math.round(n * 100);
  });

/**
 * ONE row of a catalog import (19 §9). Mirrors the quick "New Item" form, not the full
 * product form: **Item Name + Selling Price is a complete row.** Everything else is
 * optional, and the service back-fills it exactly as the form does (auto item code,
 * default unit/category). That is what makes a Tally/Vyapar/own-spreadsheet export
 * usable without editing it first.
 */
export const importRowSchema = z.object({
  /** Omit to auto-generate a per-shop item code from the name. */
  sku: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  /** Omit to file under the shop's default ("General") category. */
  category: z.string().trim().min(1).optional(),
  brand: z.string().trim().optional(),
  hsnCode: z.string().trim().optional(),
  barcode: z.string().trim().max(64).optional(),
  /** Omit to inherit the shop's last-used GST rate (resolved by the service). */
  gstRatePct: gstRatePct.optional(),
  /** Omit to use the shop's default unit (PCS). */
  baseUnitCode: z.string().trim().min(1).optional(),
  baseUnitKind: z.enum(["MEASURED", "PIECE"]).optional(),
  saleUnitCode: z.string().trim().min(1).optional(),
  saleUnitKind: z.enum(["MEASURED", "PIECE"]).optional(),
  factorToBase: positiveDecimalString.optional(),
  /** Rupees in the sheet → paise after parse. */
  salePrice: rupeesToPaise.pipe(paise),
  mrp: rupeesToPaise.pipe(paise.optional()).optional(),
  costPerBaseUnit: rupeesToPaise.pipe(paise.optional()).optional(),
  wholesalePrice: rupeesToPaise.pipe(paise.optional()).optional(),
  wholesaleMinQty: positiveDecimalString.optional(),
  priceInclusive: z.boolean().optional().default(false),
  openingStock: decimalString.optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;
