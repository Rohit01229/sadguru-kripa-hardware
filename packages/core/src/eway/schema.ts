// The ONE place e-way bill inputs are shaped (doc 20 §7). Both the server action and
// any route handler parse with these, so the rules cannot diverge by entry point.
import { z } from "zod";

const pincode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "must be a 6-digit PIN code");

const stateCode = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/, "must be a GST state code")
  .transform((v) => v.padStart(2, "0"));

/** GSTIN shape check — the portal is authoritative, this just catches typos early. */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/, "invalid GSTIN");

export const transportModes = ["ROAD", "RAIL", "AIR", "SHIP"] as const;

/**
 * Part-A (the consignment) plus optionally Part-B (the vehicle). Part-B is separate in
 * the law because goods are often booked before a vehicle is assigned — so every
 * Part-B field is optional here and the bill simply stays incomplete until they arrive.
 */
export const ewayBillDraftSchema = z.object({
  // ── Part-A ──
  fromPincode: pincode,
  toPincode: pincode,
  fromStateCode: stateCode,
  toStateCode: stateCode,
  /** Approximate road distance; drives validity. Portal caps at 4000 km. */
  distanceKm: z.number().int().min(0).max(4000).optional().nullable(),

  // ── Part-B ──
  transportMode: z.enum(transportModes).optional().nullable(),
  /** Indian vehicle registration, e.g. WB12AB1234. Punctuation is stripped. */
  vehicleNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[^A-Z0-9]/g, ""))
    .refine((v) => v === "" || /^[A-Z]{2}[A-Z0-9]{4,13}$/.test(v), "invalid vehicle number")
    .optional()
    .nullable(),
  /** Over-dimensional cargo validates at 1 day per 20 km instead of 200. */
  overDimensional: z.boolean().optional().default(false),
  transporterGstin: gstin.optional().nullable().or(z.literal("")),
  transporterName: z.string().trim().max(120).optional().nullable(),
  transportDocNo: z.string().trim().max(30).optional().nullable(),
  transportDocDate: z.coerce.date().optional().nullable(),
});
export type EwayBillDraftInput = z.input<typeof ewayBillDraftSchema>;

/** Recording the number the portal issued (we do not call the API — doc 20 §3). */
export const recordEwayBillSchema = z.object({
  /** The portal issues a 12-digit e-way bill number. */
  ewbNo: z
    .string()
    .trim()
    .regex(/^\d{12}$/, "e-way bill number is 12 digits"),
  ewbDate: z.coerce.date().optional(),
});
export type RecordEwayBillInput = z.input<typeof recordEwayBillSchema>;

/** Portal cancellation reasons (Rule 138; same codes the portal offers). */
export const ewayCancelReasons = ["DUPLICATE", "ORDER_CANCELLED", "DATA_ENTRY_MISTAKE", "OTHERS"] as const;

export const cancelEwayBillSchema = z.object({
  reason: z.enum(ewayCancelReasons),
  remark: z.string().trim().max(100).optional().nullable(),
});
export type CancelEwayBillInput = z.input<typeof cancelEwayBillSchema>;
