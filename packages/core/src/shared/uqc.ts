// UQC — Unit Quantity Codes (doc 20 §4).
//
// GST portals (e-way bill and e-invoice alike) validate the unit of measure against a
// CONTROLLED VOCABULARY. Free text like "coil" or "bucket" is rejected outright, so any
// government-facing payload has to map our shop-friendly unit codes onto this list.
//
// Our units stay shopkeeper-readable ("bag", "coil", "ft") — the shop should never have
// to think in three-letter tax codes. This translates at the boundary instead.
//
// ⚠️ The official master list lives at einvoice1.gst.gov.in/Others/MasterCodes and is
// the authority; sources disagree on whether it holds 44 or 49 entries. What follows is
// the widely-used core set, sufficient for a hardware shop. Anything unmapped falls back
// to OTH ("Others"), which is a valid code — better a truthful "Others" than a wrong
// unit that misstates the quantity on a government record.

export interface UqcEntry {
  code: string;
  label: string;
}

/** The UQC values we can emit. */
export const UQC_CODES: readonly UqcEntry[] = [
  { code: "BAG", label: "Bags" },
  { code: "BAL", label: "Bale" },
  { code: "BDL", label: "Bundles" },
  { code: "BKL", label: "Buckles" },
  { code: "BOU", label: "Billion of units" },
  { code: "BOX", label: "Box" },
  { code: "BTL", label: "Bottles" },
  { code: "BUN", label: "Bunches" },
  { code: "CAN", label: "Cans" },
  { code: "CBM", label: "Cubic metres" },
  { code: "CCM", label: "Cubic centimetres" },
  { code: "CMS", label: "Centimetres" },
  { code: "CTN", label: "Cartons" },
  { code: "DOZ", label: "Dozens" },
  { code: "DRM", label: "Drums" },
  { code: "GGK", label: "Great gross" },
  { code: "GMS", label: "Grammes" },
  { code: "GRS", label: "Gross" },
  { code: "GYD", label: "Gross yards" },
  { code: "KGS", label: "Kilograms" },
  { code: "KLR", label: "Kilolitre" },
  { code: "KME", label: "Kilometre" },
  { code: "LTR", label: "Litres" },
  { code: "MLT", label: "Millilitre" },
  { code: "MTR", label: "Metres" },
  { code: "MTS", label: "Metric ton" },
  { code: "NOS", label: "Numbers" },
  { code: "PAC", label: "Packs" },
  { code: "PCS", label: "Pieces" },
  { code: "PRS", label: "Pairs" },
  { code: "QTL", label: "Quintal" },
  { code: "ROL", label: "Rolls" },
  { code: "SET", label: "Sets" },
  { code: "SQF", label: "Square feet" },
  { code: "SQM", label: "Square metres" },
  { code: "SQY", label: "Square yards" },
  { code: "TBS", label: "Tablets" },
  { code: "TGM", label: "Ten gross" },
  { code: "THD", label: "Thousands" },
  { code: "TON", label: "Tonnes" },
  { code: "TUB", label: "Tubes" },
  { code: "UGS", label: "US gallons" },
  { code: "UNT", label: "Units" },
  { code: "YDS", label: "Yards" },
  { code: "OTH", label: "Others" },
] as const;

const VALID = new Set(UQC_CODES.map((u) => u.code));

/**
 * Shop unit code (or name) → UQC. Keys are lower-cased and stripped of punctuation, so
 * "sq ft", "SQ-FT" and "sqft" all resolve.
 *
 * Note the ones with NO real equivalent: a "coil" of wire and a "bucket" of paint are
 * counted as pieces in reality, so they map to NOS rather than OTH — the quantity still
 * means the same thing to a tax officer. "ft" genuinely has no UQC (the list has square
 * feet but not linear feet), so that one honestly becomes OTH.
 */
const UNIT_TO_UQC: Readonly<Record<string, string>> = {
  // Direct matches
  pcs: "PCS", piece: "PCS", pieces: "PCS", pc: "PCS",
  nos: "NOS", no: "NOS", number: "NOS", numbers: "NOS", unit: "UNT", units: "UNT",
  box: "BOX", boxes: "BOX", carton: "CTN", ctn: "CTN",
  bag: "BAG", bags: "BAG", sack: "BAG",
  bdl: "BDL", bundle: "BDL", bundles: "BDL",
  doz: "DOZ", dozen: "DOZ",
  set: "SET", sets: "SET", pair: "PRS", pairs: "PRS", prs: "PRS",
  pack: "PAC", packet: "PAC", pac: "PAC",
  // Weight
  kg: "KGS", kgs: "KGS", kilogram: "KGS", kilograms: "KGS",
  g: "GMS", gm: "GMS", gms: "GMS", gram: "GMS", grams: "GMS",
  ton: "TON", tonne: "TON", tonnes: "TON", mt: "MTS", quintal: "QTL", qtl: "QTL",
  // Volume
  l: "LTR", ltr: "LTR", litre: "LTR", liter: "LTR", litres: "LTR",
  ml: "MLT", mlt: "MLT", kl: "KLR",
  bottle: "BTL", btl: "BTL", can: "CAN", drum: "DRM", tube: "TUB",
  // Length / area
  m: "MTR", mtr: "MTR", metre: "MTR", meter: "MTR", metres: "MTR",
  cm: "CMS", cms: "CMS", km: "KME",
  sqft: "SQF", sqf: "SQF", squarefeet: "SQF", squarefoot: "SQF",
  sqm: "SQM", squaremetre: "SQM", sqyd: "SQY", yard: "YDS", yds: "YDS",
  cbm: "CBM", ccm: "CCM",
  // Hardware-shop vernacular with no exact UQC — counted as pieces in practice.
  coil: "NOS", bucket: "NOS", tin: "NOS", roll: "ROL", rolls: "ROL",
  sheet: "NOS", bar: "NOS", rod: "NOS", length: "NOS",
};

/** Normalise a unit code/name for lookup. */
function key(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Map a shop unit onto a UQC. Tries the code, then the name, then falls back to OTH.
 * Never throws and never returns an invalid code — a government payload must always
 * carry *something* the portal accepts.
 */
export function toUqc(unitCode: string, unitName?: string | null): string {
  const direct = UNIT_TO_UQC[key(unitCode)];
  if (direct) return direct;
  // An already-valid UQC passed straight through (e.g. a shop that typed "KGS").
  const upper = unitCode.trim().toUpperCase();
  if (VALID.has(upper)) return upper;
  if (unitName) {
    const byName = UNIT_TO_UQC[key(unitName)];
    if (byName) return byName;
  }
  return "OTH";
}

/** True when the mapping was a real match rather than the OTH fallback. */
export function hasExactUqc(unitCode: string, unitName?: string | null): boolean {
  return toUqc(unitCode, unitName) !== "OTH";
}
