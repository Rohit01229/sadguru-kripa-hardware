// Input shapes for the unified Parties directory (21d).
import { z } from "zod";

/**
 * Which side of the shop a party sits on. NOT stored as a column — it is which TABLE
 * the row came from (see the note at the top of service.ts). A single organisation
 * that both buys and sells therefore appears twice, once per role, which is also how
 * its khata and its payable genuinely differ.
 */
export const PARTY_KINDS = ["CUSTOMER", "SUPPLIER"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const partyKindSchema = z.enum(PARTY_KINDS);

export const listPartiesQuerySchema = z.object({
  /** Omit for everyone. */
  kind: partyKindSchema.optional(),
  /** Free text over name, phone and GSTIN. */
  q: z.string().trim().max(120).optional(),
  /** Only parties with money outstanding either way — the call sheet. */
  hasBalance: z.boolean().optional().default(false),
});
export type ListPartiesQuery = z.input<typeof listPartiesQuerySchema>;

/**
 * Creating a party. `kind` picks which table it lands in, so the fields that only make
 * sense for one side are validated per kind rather than being quietly ignored.
 */
export const createPartySchema = z
  .object({
    kind: partyKindSchema,
    name: z.string().trim().min(2, "Enter the party's name.").max(200),
    phone: z.string().trim().max(20).optional().nullable(),
    gstin: z
      .string()
      .trim()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i, "invalid GSTIN")
      .optional()
      .nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    /** Customers only — RETAIL or WHOLESALE decides which price slab applies. */
    type: z.enum(["RETAIL", "WHOLESALE"]).optional().default("RETAIL"),
    /**
     * Customers only, in paise: what they already owed before the app existed. Posted
     * as an OPENING ledger entry so a shop moving off a paper khata starts with the
     * right number instead of zero. Suppliers have no ledger — their balance is
     * derived from recorded purchases — so this is refused for them rather than
     * accepted and dropped.
     */
    openingBalance: z.number().int().optional().default(0),
  })
  .refine((v) => v.kind === "CUSTOMER" || v.openingBalance === 0, {
    message: "A supplier's balance comes from recorded purchases, so it cannot be set here.",
    path: ["openingBalance"],
  });
export type CreatePartyInput = z.infer<typeof createPartySchema>;
