// Input shapes for purchase orders (21c) — the buying-side mirror of salesdoc/schema.
//
// The line shape is deliberately the SAME as a GRN line (inventory/schema grnLineSchema):
// productId + receiveUnitId + quantity + cost. That is what makes "receive this order"
// a straight copy into the goods-receipt form rather than a re-derivation.
import { z } from "zod";

/** Money on the wire = non-negative integer paise (04 §2). */
const paise = z.number().int().nonnegative();

const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal")
  .refine((v) => Number(v) > 0, { message: "must be greater than 0" });

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

export const purchaseOrderLineSchema = z.object({
  productId: z.string().min(1),
  /** The unit being ordered in — matches the GRN's receive unit exactly. */
  receiveUnitId: z.string().min(1),
  quantity: positiveDecimalString,
  /** Expected landed cost per receive unit, in paise. 0 when the rate is not agreed yet. */
  costPerUnit: paise.optional().default(0),
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;

const purchaseOrderBody = {
  /** Required — an order is placed WITH someone. */
  supplierId: z.string().min(1, "Choose a supplier."),
  /** Omitted ⇒ today. Back-dateable, like every other document (21b §5). */
  date: isoDate.optional().nullable(),
  /** "Expected by" — what the shop was promised. Informational, never enforced. */
  expectedDate: isoDate.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  lines: z.array(purchaseOrderLineSchema).min(1, "Add at least one item."),
};

export const createPurchaseOrderSchema = z.object(purchaseOrderBody);
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

/** Editing replaces the whole line set, so the stored subtotal cannot desync from it. */
export const updatePurchaseOrderSchema = z.object({
  id: z.string().min(1),
  ...purchaseOrderBody,
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const cancelPurchaseOrderSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(1, "Say why this order is being cancelled.").max(300),
});
export type CancelPurchaseOrderInput = z.infer<typeof cancelPurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  status: z.enum(["OPEN", "PARTIAL", "RECEIVED", "CANCELLED"]).optional(),
  supplierId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Free text over the order number and the supplier name snapshot. */
  q: z.string().trim().max(120).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type ListPurchaseOrdersQuery = z.input<typeof listPurchaseOrdersQuerySchema>;
