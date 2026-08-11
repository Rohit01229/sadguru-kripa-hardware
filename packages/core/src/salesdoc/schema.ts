// Input shapes for the pre-sale documents — Estimate/Quotation, Proforma Invoice and
// Delivery Challan (21). Deliberately the SAME line shape as a pakka bill line
// (billing/schema.ts) so "convert to bill" is a straight copy with nothing to
// re-derive, and so a rate typed on a quote is the rate that ends up on the invoice.
import { z } from "zod";

/** Money on the wire = non-negative integer paise (04 §2). */
const paise = z.number().int().nonnegative();

const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal")
  .refine((v) => Number(v) > 0, { message: "must be greater than 0" });

const stateCode = z.string().trim().min(1).max(4);

const gstin = z
  .string()
  .trim()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i, "invalid GSTIN")
  .optional()
  .nullable();

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

/** Kinds in the order the sidebar lists them. Mirrors the Prisma enum exactly. */
export const SALES_DOC_KINDS = ["QUOTATION", "PROFORMA", "DELIVERY_CHALLAN"] as const;
export type SalesDocKind = (typeof SALES_DOC_KINDS)[number];

export const salesDocKindSchema = z.enum(SALES_DOC_KINDS);
export const salesDocStatusSchema = z.enum(["OPEN", "CONVERTED", "CANCELLED"]);

/** The party the document is addressed to. A quotation for a walk-in needs only a name. */
export const salesDocPartySchema = z.object({
  customerId: z.string().min(1).optional().nullable(),
  name: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  gstin,
});
export type SalesDocPartyInput = z.infer<typeof salesDocPartySchema>;

export const salesDocLineSchema = z.object({
  productId: z.string().min(1),
  saleUnitId: z.string().min(1),
  quantity: positiveDecimalString,
  /** Per-sale-unit rate override in paise. Omitted ⇒ the catalog/pricing default. */
  rateOverride: paise.optional().nullable(),
  /** Flat per-line discount in paise, applied BEFORE tax (03 §8). */
  lineDiscount: paise.optional().default(0),
});
export type SalesDocLineInput = z.infer<typeof salesDocLineSchema>;

const salesDocBody = {
  /**
   * Document date. Omitted ⇒ today. Back-dating is allowed and expected: a shopkeeper
   * writes up on Thursday the quote they gave on Tuesday. These are not tax invoices,
   * so no statutory date rule applies.
   */
  date: isoDate.optional().nullable(),
  placeOfSupplyState: stateCode.optional().nullable(),
  customer: salesDocPartySchema.optional().nullable(),
  lines: z.array(salesDocLineSchema).min(1, "Add at least one item."),
  billDiscount: paise.optional().default(0),
  roundOff: z.boolean().optional().default(true),
  /** "Valid till" — quotations. Ignored for the other kinds. */
  validUntil: isoDate.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
};

export const createSalesDocSchema = z.object({
  kind: salesDocKindSchema,
  ...salesDocBody,
});
export type CreateSalesDocInput = z.infer<typeof createSalesDocSchema>;

/**
 * Editing replaces the whole line set. A quotation gets revised in negotiation, so
 * this is the common path, not an exception — and a full replace keeps the persisted
 * totals impossible to desync from the lines they were computed from. `kind` is absent
 * on purpose: a quotation cannot become a challan, because its number would lie.
 */
export const updateSalesDocSchema = z.object({
  id: z.string().min(1),
  ...salesDocBody,
});
export type UpdateSalesDocInput = z.infer<typeof updateSalesDocSchema>;

export const cancelSalesDocSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(1, "Say why this is being cancelled.").max(300),
});
export type CancelSalesDocInput = z.infer<typeof cancelSalesDocSchema>;

export const listSalesDocsQuerySchema = z.object({
  kind: salesDocKindSchema.optional(),
  status: salesDocStatusSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  customerId: z.string().min(1).optional(),
  /** Free text over document number and party name. */
  q: z.string().trim().max(120).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type ListSalesDocsQuery = z.input<typeof listSalesDocsQuerySchema>;
