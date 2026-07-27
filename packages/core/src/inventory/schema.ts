// The ONE place inventory/supplier input shapes are defined (04 §4). Both the
// server action and the route handler parse with these schemas. Money is integer
// paise on the wire (04 §2); quantities/factors are decimal strings (parsed to
// Prisma Decimal in the service). PIECE-vs-MEASURED fractional-qty enforcement is a
// domain rule (uom.toBaseQty in the service), not a Zod concern.
import { z } from "zod";

/** Money on the wire = non-negative integer paise (04 §2). */
const paise = z.number().int().nonnegative();

/** A positive decimal-string quantity / factor (> 0). */
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal")
  .refine((v) => Number(v) > 0, { message: "must be greater than 0" });

/** A signed decimal-string magnitude (adjustments may be + or −; sign is separate). */
const positiveMagnitudeString = positiveDecimalString;

/** ISO date string → Date (optional). */
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

// ─────────────────── GRN (goods-received → stock-in) ───────────────────
export const grnLineSchema = z.object({
  productId: z.string().min(1),
  /** The sale unit the goods are RECEIVED in (qty is converted to base via its factor). */
  receiveUnitId: z.string().min(1),
  /** Quantity in the receive unit (decimal string). */
  quantity: positiveDecimalString,
  /** Optional batch code; when present an expiry-tracked Batch row is upserted. */
  batchNo: z.string().trim().min(1).max(64).optional().nullable(),
  expiryDate: isoDate.optional().nullable(),
  mfgDate: isoDate.optional().nullable(),
  mrp: paise.optional().nullable(),
  /** Landed cost per RECEIVE unit in paise (converted to per-base cost in the service). */
  costPerReceiveUnit: paise.optional().default(0),
});
export type GrnLineInput = z.infer<typeof grnLineSchema>;

export const recordGrnSchema = z.object({
  supplierId: z.string().min(1).optional().nullable(),
  supplierInvoiceNo: z.string().trim().max(64).optional().nullable(),
  receivedAt: isoDate.optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  lines: z.array(grnLineSchema).min(1),
});
export type RecordGrnInput = z.infer<typeof recordGrnSchema>;

// ─────────────────── Stock adjustment (signed + reason) ───────────────────
export const adjustStockSchema = z.object({
  productId: z.string().min(1),
  /** Direction of the adjustment: IN (+) or OUT (−). */
  direction: z.enum(["IN", "OUT"]),
  /** The sale unit the magnitude is expressed in (converted to base). */
  saleUnitId: z.string().min(1),
  /** Positive magnitude (sign comes from `direction`). */
  quantity: positiveMagnitudeString,
  /** REQUIRED reason (damage/wastage/count/opening) — adjustments are never silent. */
  reason: z.string().trim().min(1).max(200),
  /** Opt-in to bypass the negative-stock guard for an OUT (per-request; product flag also applies). */
  allowNegative: z.boolean().optional().default(false),
  batchNo: z.string().trim().min(1).max(64).optional().nullable(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

// ─────────────────── Set absolute stock level (manual edit → delta adjustment) ───────────────────
// Operators want to just type the real on-hand count; the service turns the
// difference from the current on-hand into a signed ADJUST movement so the ledger
// and audit trail stay intact (no silent overwrite of ProductStock).
export const setStockLevelSchema = z.object({
  productId: z.string().min(1),
  /** Absolute target on-hand in BASE units (>= 0). */
  onHand: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal"),
  /** Optional note; the service defaults it to a manual-edit reason. */
  reason: z.string().trim().min(1).max(200).optional(),
});
export type SetStockLevelInput = z.infer<typeof setStockLevelSchema>;

// ─────────────────── Returns (sales-return-in / purchase-return-out) ───────────────────
export const recordReturnSchema = z.object({
  productId: z.string().min(1),
  /** SALES → goods come back IN (+); PURCHASE → goods go back to supplier OUT (−). */
  kind: z.enum(["SALES", "PURCHASE"]),
  saleUnitId: z.string().min(1),
  quantity: positiveMagnitudeString,
  reason: z.string().trim().min(1).max(200),
  /** Reference to the originating invoice/GRN (free-form ref id). */
  refId: z.string().trim().max(64).optional().nullable(),
  batchNo: z.string().trim().min(1).max(64).optional().nullable(),
  /** PURCHASE returns may bypass the negative guard (mirrors adjustment policy). */
  allowNegative: z.boolean().optional().default(false),
});
export type RecordReturnInput = z.infer<typeof recordReturnSchema>;

// ─────────────────── List / report queries ───────────────────
/** The signed stock-movement kinds (mirrors the Prisma MovementKind enum). */
export const movementKindSchema = z.enum([
  "GRN_IN",
  "SALE_OUT",
  "KACHA_OUT",
  "ADJUST_IN",
  "ADJUST_OUT",
  "SALES_RETURN_IN",
  "PURCHASE_RETURN_OUT",
  "ORDER_DISPATCH_OUT",
]);
export type MovementKindFilter = z.infer<typeof movementKindSchema>;

export const stockListQuerySchema = z.object({
  q: z.string().trim().optional(),
  /** Only items at/below reorder level (legacy name). */
  lowOnly: z.boolean().optional().default(false),
  /** Only items at/below reorder level (additive alias for `lowOnly`; ORs with it). */
  lowStockOnly: z.boolean().optional(),
  /** Filter the stock list to one category by id (additive). */
  categoryId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type StockListQuery = z.input<typeof stockListQuerySchema>;

export const movementsQuerySchema = z.object({
  productId: z.string().min(1).optional(),
  /** Filter the ledger to a single movement kind (additive). */
  kind: movementKindSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type MovementsQuery = z.input<typeof movementsQuerySchema>;

export const nearExpiryQuerySchema = z.object({
  /** Days-ahead window; batches expiring within this many days are returned. */
  withinDays: z.number().int().min(1).max(3650).optional().default(30),
});
export type NearExpiryQuery = z.input<typeof nearExpiryQuerySchema>;

// ─────────────────── Suppliers CRUD ───────────────────
export const upsertSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  gstin: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
});
export type UpsertSupplierInput = z.infer<typeof upsertSupplierSchema>;

export const editSupplierSchema = upsertSupplierSchema.partial();
export type EditSupplierInput = z.infer<typeof editSupplierSchema>;
