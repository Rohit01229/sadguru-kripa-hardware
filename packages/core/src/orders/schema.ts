// The ONE place orders / cart / customer-account input shapes are defined (04
// Orders + Payments). Both the storefront route handler and the server action parse
// with these schemas; the admin fulfilment routes reuse the status-transition ones.
// Money is integer paise on the wire (04 §2); quantities are decimal strings
// (parsed to Prisma Decimal in the service). Ownership (.own) is enforced in the
// service against session.customerId, never in Zod.
import { z } from "zod";

/** A positive decimal-string quantity (> 0). */
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal")
  .refine((v) => Number(v) > 0, { message: "must be greater than 0" });

/** GSTIN: 15-char India format. Loose check; full checksum is a TBD (04 §8.3). */
const gstin = z
  .string()
  .trim()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i, "invalid GSTIN")
  .optional()
  .nullable();

// ─────────────────── Cart (server-validated; client/session-held qty) ───────────────────
/** A cart line the storefront posts (sale unit + qty). Pricing/stock are resolved server-side. */
export const cartItemSchema = z.object({
  productId: z.string().min(1),
  saleUnitId: z.string().min(1),
  quantity: positiveDecimalString,
});
export type CartItemInput = z.infer<typeof cartItemSchema>;

export const cartSchema = z.object({
  items: z.array(cartItemSchema).min(1),
});
export type CartInput = z.infer<typeof cartSchema>;

/** Price a whole cart for the checkout summary (delivery fee + place-of-supply preview). */
export const priceCartSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  /** Optional delivery address to preview the delivery fee + place-of-supply tax kind. */
  addressId: z.string().min(1).optional().nullable(),
  fulfilment: z.enum(["DELIVERY", "PICKUP"]).optional().default("DELIVERY"),
});
export type PriceCartInput = z.infer<typeof priceCartSchema>;

// ─────────────────── Place order ───────────────────
export const placeOrderSchema = z.object({
  fulfilment: z.object({
    type: z.enum(["DELIVERY", "PICKUP"]),
    /** Required for DELIVERY (drives place-of-supply + delivery fee); ignored for PICKUP. */
    addressId: z.string().min(1).optional().nullable(),
  }),
  lines: z.array(cartItemSchema).min(1),
  /** Optional B2B GSTIN snapshot on the order's customer party. */
  gstin,
  /**
   * RAZORPAY → order is PENDING_PAYMENT and a gateway order is created; PAY_LATER →
   * pay-at-store / on-delivery, order stands PAY_LATER but STILL reserves stock.
   */
  paymentMethod: z.enum(["RAZORPAY", "PAY_LATER"]),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/** ISO date string → Date (optional). Validated for parseability only. */
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

// ─────────────────── Customer order reads ───────────────────
export const listOrdersQuerySchema = z.object({
  status: z
    .enum([
      "PENDING_PAYMENT",
      "PAY_LATER",
      "CONFIRMED",
      "PACKED",
      "DISPATCHED",
      "COMPLETED",
      "CANCELLED",
    ])
    .optional(),
  /** Inclusive lower bound on order createdAt (additive; omit for no lower bound). */
  from: isoDate.optional(),
  /** Inclusive upper bound on order createdAt (additive; omit for no upper bound). */
  to: isoDate.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type ListOrdersQuery = z.input<typeof listOrdersQuerySchema>;

// ─────────────────── Cancel (customer, before dispatch) ───────────────────
export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// ─────────────────── Razorpay gateway order (create) ───────────────────
export const createGatewayOrderSchema = z.object({
  orderId: z.string().min(1),
});
export type CreateGatewayOrderInput = z.infer<typeof createGatewayOrderSchema>;

// ─────────────────── Customer profile + addresses ───────────────────
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(20).optional().nullable(),
  gstin,
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const upsertAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(120),
  /** Two-digit India state code — the place-of-supply driver (03 §8). */
  state: z.string().trim().min(1).max(4),
  pincode: z.string().trim().regex(/^\d{6}$/, "pincode must be 6 digits"),
  isDefault: z.boolean().optional().default(false),
});
export type UpsertAddressInput = z.infer<typeof upsertAddressSchema>;

// ─────────────────── Admin fulfilment (staff) ───────────────────
export const dispatchOrderSchema = z.object({
  /** Apply per-invoice round-to-rupee on the generated pakka invoice (03 §8). */
  roundOff: z.boolean().optional().default(true),
});
/** Input type (roundOff optional — the schema fills the default). */
export type DispatchOrderInput = z.input<typeof dispatchOrderSchema>;

export const adminListOrdersQuerySchema = listOrdersQuerySchema;
export type AdminListOrdersQuery = z.input<typeof adminListOrdersQuerySchema>;
