// The ONE place billing input shapes are defined (04 §4, §8.3/§8.4). Both the
// server action and the route handler parse with these schemas. Money is integer
// paise on the wire (04 §2); quantities are decimal strings (parsed to Prisma
// Decimal in the service). PIECE-vs-MEASURED fractional-qty enforcement is a domain
// rule (uom.toBaseQty in the service), not a Zod concern.
import { z } from "zod";

/** Money on the wire = non-negative integer paise (04 §2). */
const paise = z.number().int().nonnegative();

/** A positive decimal-string quantity (> 0). */
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal")
  .refine((v) => Number(v) > 0, { message: "must be greater than 0" });

/** GST state code (place of supply / home state — 03 §8). Two-digit India state code. */
const stateCode = z.string().trim().min(1).max(4);

/** GSTIN: 15-char India format. Loose check; full checksum is a TBD (04 §8.3 input validation). */
const gstin = z
  .string()
  .trim()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i, "invalid GSTIN")
  .optional()
  .nullable();

// ─────────────────── Customer snapshot (pakka only) ───────────────────
export const billCustomerSchema = z.object({
  /** Existing Customer party (khata / repeat). Null for a pure walk-in. */
  customerId: z.string().min(1).optional().nullable(),
  /** Snapshot name printed on the invoice (walk-in or override). */
  name: z.string().trim().max(200).optional().nullable(),
  gstin,
});
export type BillCustomerInput = z.infer<typeof billCustomerSchema>;

// ─────────────────── Lines ───────────────────
/** A kacha line — no price, no tax; only the goods + qty leave the shop (03 §6). */
export const kachaLineSchema = z.object({
  productId: z.string().min(1),
  saleUnitId: z.string().min(1),
  quantity: positiveDecimalString,
});
export type KachaLineInput = z.infer<typeof kachaLineSchema>;

/** A pakka line — sale qty, optional per-line discount (paise) and manual rate override (paise). */
export const pakkaLineSchema = z.object({
  productId: z.string().min(1),
  saleUnitId: z.string().min(1),
  quantity: positiveDecimalString,
  /**
   * Manual per-sale-unit rate override in paise (10 §4 — part of bill.pakka.create
   * in v1). When omitted the catalog/pricing-resolved price is used. This is the
   * sale-unit price (inclusive iff the product is priceInclusive — 03 §8).
   */
  rateOverride: paise.optional().nullable(),
  /** Per-line flat discount in paise, applied to the line BEFORE tax (03 §8). */
  lineDiscount: paise.optional().default(0),
});
export type PakkaLineInput = z.infer<typeof pakkaLineSchema>;

// ─────────────────── Payment ───────────────────
/**
 * Counter payment. CASH/UPI/CARD are fully supported in S4; KHATA (credit) posts
 * the balance to the customer ledger — that branch lands in S5 (here it is rejected
 * unless explicitly enabled, so we never silently drop a receivable).
 */
export const paymentSchema = z.object({
  mode: z.enum(["CASH", "UPI", "CARD", "KHATA"]),
  /** Amount tendered/received in paise (part-payment supported; 0 for pure khata). */
  amountPaid: paise.optional().default(0),
  /** UPI/card txn reference (optional). */
  reference: z.string().trim().max(120).optional().nullable(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

// ─────────────────── Kacha decrement (ephemeral — NOT idempotent) ───────────────────
export const kachaDecrementSchema = z.object({
  lines: z.array(kachaLineSchema).min(1),
});
export type KachaDecrementInput = z.infer<typeof kachaDecrementSchema>;

// ─────────────────── Pakka create ───────────────────
export const finalizePakkaSchema = z.object({
  /** Place of supply (03 §8). Defaults to the shop home state at the service if omitted. */
  placeOfSupplyState: stateCode.optional().nullable(),
  customer: billCustomerSchema.optional().nullable(),
  lines: z.array(pakkaLineSchema).min(1),
  /** Bill-level flat discount in paise, spread across lines BEFORE tax (03 §8). */
  billDiscount: paise.optional().default(0),
  /** Apply per-invoice round-to-rupee with a round_off line (03 §8). */
  roundOff: z.boolean().optional().default(true),
  payment: paymentSchema,
});
export type FinalizePakkaInput = z.infer<typeof finalizePakkaSchema>;

// ─────────────────── Convert kacha → pakka ───────────────────
export const convertKachaSchema = finalizePakkaSchema.extend({
  /**
   * True when a prior /kacha/decrement already removed the stock (04 §8.4). The pakka
   * create then ATTRIBUTES the existing KACHA_OUT movements instead of double-deducting.
   */
  stockAlreadyDecremented: z.boolean().optional().default(false),
  /** Movement ids returned by the prior kacha decrement (one per line, in order). */
  stockMovementRefs: z.array(z.string().min(1)).optional().default([]),
});
export type ConvertKachaInput = z.infer<typeof convertKachaSchema>;

// ─────────────────── List / get invoices ───────────────────
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

export const listInvoicesQuerySchema = z.object({
  /** Filter by invoice status (ACTIVE | CANCELLED). Omit for both (legacy behaviour). */
  status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  customerId: z.string().min(1).optional(),
  paymentMode: z.enum(["CASH", "UPI", "CARD", "CREDIT"]).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type ListInvoicesQuery = z.input<typeof listInvoicesQuerySchema>;
