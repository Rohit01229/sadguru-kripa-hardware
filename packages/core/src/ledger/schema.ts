// The ONE place ledger / counter-customer / credit-note / cancel input shapes are
// defined (04 Khata-Ledger + Billing cancel/credit-note). Both the server action
// and the route handler parse with these schemas. Money is integer paise on the
// wire (04 §2); quantities are decimal strings (parsed to Prisma Decimal in the
// service). Customer party (counter/credit) is DISTINCT from the storefront
// CustomerAccount (13 §7) — these schemas shape the Customer party only.
import { z } from "zod";

/** Money on the wire = non-negative integer paise (04 §2). */
const paise = z.number().int().nonnegative();

/** A positive decimal-string quantity (> 0). */
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal")
  .refine((v) => Number(v) > 0, { message: "must be greater than 0" });

/** GSTIN: 15-char India format. Loose check; full checksum is a TBD. */
const gstin = z
  .string()
  .trim()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i, "invalid GSTIN")
  .optional()
  .nullable();

// ─────────────────── Counter-customer CRUD (customers.*) ───────────────────
export const upsertCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(20).optional().nullable(),
  gstin,
  type: z.enum(["RETAIL", "WHOLESALE"]).optional().default("RETAIL"),
  /** Optional credit limit in paise (informational in v1). */
  creditLimit: paise.optional().nullable(),
});
export type UpsertCustomerInput = z.infer<typeof upsertCustomerSchema>;

/**
 * Aging buckets a customer's net outstanding can fall into (13 §7; mirrors AgingDTO).
 * `current` is the 0-30 day bucket; `b31to60` the 31-60; `b60plus` the 60+.
 * Selecting a bucket returns customers whose aging puts SOME unpaid debit in it.
 */
export const agingBucketSchema = z.enum(["current", "b31to60", "b60plus"]);
export type AgingBucket = z.infer<typeof agingBucketSchema>;

export const listCustomersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /**
   * Only customers who currently OWE the shop (net outstanding > 0). Additive +
   * optional — omitting it keeps the prior (all-customers) behaviour. Outstanding is
   * a derived Σ over LedgerEntry (not a stored column), so this filter is applied
   * after load and DISABLES cursor pagination (see service) — first page only.
   */
  hasOutstanding: z.boolean().optional(),
  /**
   * Only customers with unpaid debt in the given aging bucket (current | b31to60 |
   * b60plus). Like `hasOutstanding`, this is derived (FIFO aging over the ledger), so
   * it is applied after load and DISABLES cursor pagination — first page only.
   */
  agingBucket: agingBucketSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type ListCustomersQuery = z.input<typeof listCustomersQuerySchema>;

/** Optional from/to (ISO) window for a khata statement (additive — omit for the full history). */
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

export const statementQuerySchema = z.object({
  /** Inclusive lower bound on entry createdAt (ISO). Omit for "from the beginning". */
  from: isoDate.optional(),
  /** Inclusive upper bound on entry createdAt (ISO). Omit for "up to now". */
  to: isoDate.optional(),
});
export type StatementQuery = z.input<typeof statementQuerySchema>;

// ─────────────────── Ledger payment (khata receipt — idempotent) ───────────────────
export const recordPaymentSchema = z.object({
  /** Amount received in paise (> 0). */
  amount: paise.refine((v) => v > 0, { message: "amount must be greater than 0" }),
  mode: z.enum(["CASH", "UPI", "CARD"]),
  /** UPI/card txn reference (optional). */
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

// ─────────────────── Reminder (queue stub for S7) ───────────────────
export const triggerReminderSchema = z.object({
  /** Channel for the dues reminder — EMAIL is the v1 primary (SMS where DLT approved). */
  channel: z.enum(["EMAIL", "SMS"]).optional().default("EMAIL"),
});
export type TriggerReminderInput = z.infer<typeof triggerReminderSchema>;

// ─────────────────── Cancel invoice (owner-only) ───────────────────
export const cancelInvoiceSchema = z.object({
  /** A cancellation reason is REQUIRED (10 §7 void log; 04 Billing-cancel). */
  reason: z.string().trim().min(1, "a cancellation reason is required").max(500),
});
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;

// ─────────────────── Create credit note (partial returns + refund mode) ───────────────────
/**
 * A credit-note line references a product/sale-unit on the ORIGINAL invoice and the
 * quantity being returned. The taxable value + tax are re-derived in the service
 * from the original invoice line's effective unit price (never trusted from the
 * client) so a partial return is priced exactly as it was billed.
 */
export const creditNoteLineSchema = z.object({
  productId: z.string().min(1),
  saleUnitId: z.string().min(1),
  /** Quantity returned, in the sale unit (must not exceed what was billed). */
  quantity: positiveDecimalString,
});
export type CreditNoteLineInput = z.infer<typeof creditNoteLineSchema>;

export const createCreditNoteSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
  lines: z.array(creditNoteLineSchema).min(1),
  /** How the refund is settled (13 §8). KHATA_ADJUST credits the customer ledger. */
  refundMode: z.enum(["CASH", "UPI", "KHATA_ADJUST", "GATEWAY"]),
});
export type CreateCreditNoteInput = z.infer<typeof createCreditNoteSchema>;
