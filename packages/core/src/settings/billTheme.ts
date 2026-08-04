// Bill theme — the no-code "make my invoice look like mine" layer (19 §7, plan 15 §3).
//
// SHAPE: one theme per shop, stored as JSON on StoreConfig. That mirrors myBillBook,
// which gives a business preset themes to pick from plus ONE customisable template —
// not a template library. Plan 15's fuller multi-template model (per paper size, per
// doc type, cloned from presets) remains the upgrade path; this is its first slice and
// the config below is deliberately a subset of that schema so it can widen later.
//
// SAFETY: the config can only ever hold closed enums, clamped numbers, and plain text.
// There is no colour string, no CSS, no HTML, no class name — so a tampered payload
// cannot carry an injection, and a theme can never move a legally-required element off
// a GST tax invoice. Anything mandatory under CGST Rule 46 (GSTIN, tax breakup, HSN,
// amount in words, invoice number) is simply NOT expressible as hideable here.
import { z } from "zod";

/** Brand accents. Tokens, not hex — the renderer maps these to the design system. */
export const BILL_ACCENTS = ["espresso", "amber", "kraft", "ink", "none"] as const;
export type BillAccent = (typeof BILL_ACCENTS)[number];

export const BILL_FONTS = ["sans", "serif", "mono"] as const;
export const BILL_DENSITY = ["compact", "comfortable"] as const;
export const BILL_TABLE_BORDERS = ["ruled", "minimal", "boxed"] as const;
export const BILL_ALIGN = ["left", "center"] as const;

/** Free text on a bill. Escaped at render; capped so a theme can't become a document. */
const shortText = z.string().trim().max(120);

export const billThemeSchema = z.object({
  /** Bumped only if the shape changes incompatibly; lets us forward-migrate stored JSON. */
  schemaVersion: z.literal(1).default(1),

  // ── Look ──
  accent: z.enum(BILL_ACCENTS).default("espresso"),
  fontFamily: z.enum(BILL_FONTS).default("sans"),
  /** Base type size in points. Clamped to what actually prints legibly. */
  baseSizePt: z.number().int().min(7).max(14).default(10),
  density: z.enum(BILL_DENSITY).default("comfortable"),
  tableBorders: z.enum(BILL_TABLE_BORDERS).default("ruled"),
  zebraRows: z.boolean().default(false),
  outerBorder: z.boolean().default(true),
  headerAlign: z.enum(BILL_ALIGN).default("center"),

  // ── What appears (mandatory GST elements are absent by design — not hideable) ──
  showLogo: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  showContact: z.boolean().default(true),
  showCustomerAddress: z.boolean().default(true),
  // NOTE: only toggles backed by data actually present on InvoiceLine live here. MRP and
  // a separate unit column are deliberately absent — the invoice DTO snapshots neither,
  // and a switch that silently does nothing is worse than no switch.
  showHsnColumn: z.boolean().default(true),
  showBankDetails: z.boolean().default(true),
  showTerms: z.boolean().default(true),
  showSignature: z.boolean().default(true),
  showFooterNote: z.boolean().default(true),

  // ── Wording (token-substituted, then escaped) ──
  tagline: shortText.default(""),
  signatureLabel: shortText.default("Authorised Signatory"),
  footerNote: shortText.default("Thank you for your business!"),
});

export type BillTheme = z.infer<typeof billThemeSchema>;

/** The theme used when a shop has never opened the editor. */
export const DEFAULT_BILL_THEME: BillTheme = billThemeSchema.parse({});

/**
 * Starter looks (19 §7). myBillBook opens with a gallery rather than a blank form, and
 * that is most of the perceived "customisation" — picking one is a single tap, and the
 * controls below then fine-tune it.
 */
export interface BillThemePreset {
  key: string;
  /** Owner-facing name. */
  name: string;
  /** One line describing who it suits. */
  description: string;
  theme: BillTheme;
}

export const BILL_THEME_PRESETS: readonly BillThemePreset[] = [
  {
    key: "classic",
    name: "Classic",
    description: "Ruled table, centred header — the familiar shop invoice.",
    theme: billThemeSchema.parse({ accent: "espresso", fontFamily: "sans", tableBorders: "ruled" }),
  },
  {
    key: "modern",
    name: "Modern",
    description: "Lighter rules and roomier spacing.",
    theme: billThemeSchema.parse({
      accent: "amber",
      fontFamily: "sans",
      tableBorders: "minimal",
      headerAlign: "left",
      outerBorder: false,
      zebraRows: true,
    }),
  },
  {
    key: "compact",
    name: "Compact",
    description: "Fits more lines on a page — good for long bills.",
    theme: billThemeSchema.parse({
      accent: "ink",
      baseSizePt: 8,
      density: "compact",
      tableBorders: "minimal",
      showBankDetails: false,
    }),
  },
  {
    key: "formal",
    name: "Formal",
    description: "Boxed and serif — for B2B and inter-state invoices.",
    theme: billThemeSchema.parse({
      accent: "ink",
      fontFamily: "serif",
      tableBorders: "boxed",
      outerBorder: true,
    }),
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "No logo, no frills — just the numbers.",
    theme: billThemeSchema.parse({
      accent: "none",
      tableBorders: "minimal",
      outerBorder: false,
      showLogo: false,
      showBankDetails: false,
      showTerms: false,
      showFooterNote: false,
    }),
  },
] as const;

/**
 * Fill free-text fields from an allow-list. A plain `replace` over known tokens — never
 * a template engine — so an unknown `{{…}}` is stripped rather than evaluated.
 */
export function substituteTokens(
  text: string,
  vars: {
    shopName?: string | null;
    shopGstin?: string | null;
    shopPhone?: string | null;
    invoiceNo?: string | null;
    customerName?: string | null;
  },
): string {
  // A Map, NOT an object literal. With a plain object, `table[key]` walks the prototype
  // chain: `{{constructor}}` would resolve to Object's constructor and stringify
  // "function Object() { [native code] }" onto a customer's invoice. A Map has no such
  // inherited keys, so an unknown token can only ever be the empty string.
  const table = new Map<string, string>([
    ["shop.name", vars.shopName ?? ""],
    ["shop.gstin", vars.shopGstin ?? ""],
    ["shop.phone", vars.shopPhone ?? ""],
    ["invoice.no", vars.invoiceNo ?? ""],
    ["customer.name", vars.customerName ?? ""],
  ]);
  // Match any token-ish run (including _ and digits) so unknown ones are consistently
  // stripped rather than left on the bill as literal braces.
  return text.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_, key: string) => table.get(key) ?? "");
}

/** Parse stored JSON into a usable theme, falling back to the default on anything odd. */
export function readBillTheme(stored: unknown): BillTheme {
  if (stored === null || stored === undefined) return DEFAULT_BILL_THEME;
  const parsed = billThemeSchema.safeParse(stored);
  // A theme is cosmetic: a corrupt or future-version blob must never break printing.
  return parsed.success ? parsed.data : DEFAULT_BILL_THEME;
}
