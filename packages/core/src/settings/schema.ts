// The ONE place StoreConfig (settings.*) input is shaped (04 — settings is owner-only;
// 13 §10). The single "default" StoreConfig row holds the configurable v1 TBDs:
// shop identity (name/GSTIN/home-state/address/logo/bank/T&C), the invoice prefix
// format, delivery fee/threshold, reservation TTL, and the GST rounding mode. Update
// is a PARTIAL patch — every field optional so the admin screen can save one field.
import { z } from "zod";

/** Money on the wire = non-negative integer paise (04 §2). */
const paise = z.number().int().nonnegative();

/** India state code (2-digit GST place-of-supply code, e.g. "19"). */
const stateCode = z
  .string()
  .trim()
  .regex(/^\d{2}$/, "must be a 2-digit state code");

const gstin = z
  .string()
  .trim()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i, "invalid GSTIN");

export const updateStoreConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    gstin: gstin.nullable().optional(),
    homeState: stateCode.optional(),
    address: z.string().trim().max(1000).nullable().optional(),
    logoKey: z.string().trim().max(500).nullable().optional(),
    bankDetails: z.string().trim().max(2000).nullable().optional(),
    invoiceTerms: z.string().trim().max(2000).nullable().optional(),
    /** Invoice prefix format (03 §7) — must contain the sequence token. */
    invoicePrefixFormat: z
      .string()
      .trim()
      .max(60)
      .refine((v) => v.includes("{SEQ6}") || v.includes("{SEQ}"), {
        message: "format must contain a {SEQ6} (or {SEQ}) token",
      })
      .optional(),
    deliveryFlatFee: paise.optional(),
    freeDeliveryThreshold: paise.nullable().optional(),
    reservationTtlMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
    gstRoundingMode: z.enum(["PER_INVOICE", "PER_LINE", "NONE"]).optional(),
  })
  .strict();
export type UpdateStoreConfigInput = z.infer<typeof updateStoreConfigSchema>;
