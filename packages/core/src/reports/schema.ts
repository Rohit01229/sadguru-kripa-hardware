// The ONE place report query inputs are shaped (04 Reports; 14-impl-plan Chunk 11).
// Reports are READ-ONLY — no mutation schemas live here. Both the route handler and
// any server component parse with these. Dates are calendar strings (YYYY-MM-DD) or
// a GST period (YYYY-MM); the service resolves them to UTC day boundaries. Money is
// integer paise on the wire (04 §2).
import { z } from "zod";

/** A calendar date string YYYY-MM-DD (the day in the store's wall-clock; UTC here). */
const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date");

/** A GST return period YYYY-MM (e.g. "2026-06"). */
const periodString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "must be a YYYY-MM period");

// ─────────────────── Sales report (day / item / category / payment-mode) ───────────────────
export const salesReportQuerySchema = z.object({
  /** Inclusive from-date (defaults to `to` when omitted → single day). */
  from: dateString.optional(),
  /** Inclusive to-date (defaults to today when omitted). */
  to: dateString.optional(),
  /** How to group the active (non-cancelled) pakka sales. */
  groupBy: z.enum(["day", "item", "category", "paymentMode"]).optional().default("day"),
});
export type SalesReportQuery = z.input<typeof salesReportQuerySchema>;

// ─────────────────── Day-end summary (pakka only; kacha excluded by design) ───────────────────
export const dayEndQuerySchema = z.object({
  /** The day to summarise (defaults to today). */
  date: dateString.optional(),
});
export type DayEndQuery = z.input<typeof dayEndQuerySchema>;

// ─────────────────── GSTR-1 export (B2B / B2C / CN + HSN) ───────────────────
export const gstr1QuerySchema = z.object({
  period: periodString,
  /** json (default) or csv. CSV emits the four GSTR-1 sections concatenated. */
  format: z.enum(["json", "csv"]).optional().default("json"),
});
export type Gstr1Query = z.input<typeof gstr1QuerySchema>;

// ─────────────────── Stock valuation ───────────────────
export const stockValuationQuerySchema = z.object({
  /** Only items with on-hand > 0 when true (default false → list all active). */
  inStockOnly: z.coerce.boolean().optional().default(false),
});
export type StockValuationQuery = z.input<typeof stockValuationQuerySchema>;

// ─────────────────── Audit log viewer (audit.read) ───────────────────
export const auditQuerySchema = z.object({
  action: z.string().trim().max(120).optional(),
  targetType: z.string().trim().max(120).optional(),
  targetId: z.string().trim().max(120).optional(),
  actorStaffId: z.string().trim().max(120).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;
