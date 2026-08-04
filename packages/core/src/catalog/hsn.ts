// HSN lookup by plain item name (19 §3 — myBillBook parity: "Find HSN Code").
//
// The shopkeeper types "cement" or "screw", not "2523". This is a curated, offline
// dataset of the HSN headings a HARDWARE store actually bills, each with search
// keywords and the GST rate that commonly applies.
//
// IMPORTANT — the rate is a SUGGESTION, not tax advice. HSN classification depends on
// the exact good (material, size, use), and rates change with GST notifications (the
// Sept-2025 rationalisation moved much of the old 12%/28% into 5%/18%). The UI must
// present the rate as a pre-fill the shopkeeper can overwrite, and say so. We keep the
// list intentionally short and hardware-specific: a wrong-but-plausible match is worse
// than no match, so we would rather return nothing than guess wildly.
//
// 4-digit headings only. That is what a small shop needs on an invoice (6/8-digit is
// required above the ₹5cr turnover threshold), and it keeps the mapping defensible.

export interface HsnEntry {
  /** 4-digit HSN heading. */
  code: string;
  /** Short, shopkeeper-readable description. */
  description: string;
  /** Commonly-applied GST rate for this heading, as a percent string. Suggestion only. */
  gstRatePct: string;
  /** Lowercase search terms, including Hindi-English shop vernacular. */
  keywords: readonly string[];
}

export const HSN_CATALOG: readonly HsnEntry[] = [
  // ── Cement, concrete, masonry ──
  { code: "2523", description: "Cement (OPC, PPC, white cement)", gstRatePct: "18", keywords: ["cement", "opc", "ppc", "portland", "white cement", "siment"] },
  { code: "6810", description: "Articles of cement or concrete (blocks, pipes, tiles)", gstRatePct: "18", keywords: ["concrete block", "cement block", "paver", "concrete pipe", "rcc"] },
  { code: "2505", description: "Natural sand", gstRatePct: "5", keywords: ["sand", "river sand", "baalu", "balu"] },
  { code: "2517", description: "Pebbles, gravel, crushed stone (aggregate)", gstRatePct: "5", keywords: ["gravel", "aggregate", "crushed stone", "gitti", "kapchi", "metal chips"] },
  { code: "2520", description: "Gypsum, plasters (POP)", gstRatePct: "5", keywords: ["gypsum", "plaster of paris", "pop", "plaster"] },
  { code: "2522", description: "Quicklime, slaked lime", gstRatePct: "5", keywords: ["lime", "chuna", "quicklime"] },

  // ── Paints, putty, adhesives, chemicals ──
  { code: "3208", description: "Paints & varnishes (synthetic polymer, non-aqueous)", gstRatePct: "18", keywords: ["paint", "enamel", "varnish", "synthetic enamel", "wood polish", "pu paint"] },
  { code: "3209", description: "Paints & varnishes (water-based / emulsion)", gstRatePct: "18", keywords: ["emulsion", "distemper", "water based paint", "acrylic paint", "wall paint"] },
  { code: "3214", description: "Wall putty, fillers, mastics, sealants", gstRatePct: "18", keywords: ["putty", "wall putty", "filler", "sealant", "silicone", "mastic", "caulk"] },
  { code: "3506", description: "Prepared glues & adhesives", gstRatePct: "18", keywords: ["adhesive", "glue", "fevicol", "gum", "solution", "bond", "epoxy"] },
  { code: "3210", description: "Other paints; prepared water pigments", gstRatePct: "18", keywords: ["primer", "distemper powder", "pigment", "colour"] },
  { code: "2707", description: "Turpentine / thinner (mineral)", gstRatePct: "18", keywords: ["thinner", "turpentine", "tarpin"] },
  { code: "3403", description: "Lubricating preparations, grease", gstRatePct: "18", keywords: ["grease", "lubricant", "oil spray", "wd40"] },
  { code: "3824", description: "Chemical preparations (waterproofing compounds)", gstRatePct: "18", keywords: ["waterproofing", "waterproof", "chemical", "compound", "admixture"] },

  // ── Iron, steel & structures ──
  { code: "7213", description: "Bars & rods of iron/steel, hot-rolled (TMT)", gstRatePct: "18", keywords: ["tmt", "sariya", "saria", "steel bar", "rod", "reinforcement", "rebar"] },
  { code: "7214", description: "Other bars & rods of iron or steel", gstRatePct: "18", keywords: ["steel rod", "round bar", "square bar", "flat bar"] },
  { code: "7216", description: "Angles, shapes & sections of iron/steel", gstRatePct: "18", keywords: ["angle", "channel", "beam", "girder", "section", "patti"] },
  { code: "7306", description: "Tubes & pipes of iron or steel", gstRatePct: "18", keywords: ["steel pipe", "gi pipe", "ms pipe", "tube", "square pipe"] },
  { code: "7308", description: "Structures & parts of iron/steel (gates, grills, shutters)", gstRatePct: "18", keywords: ["gate", "grill", "shutter", "railing", "structure", "truss"] },
  { code: "7314", description: "Wire cloth, grill, netting & fencing of iron/steel", gstRatePct: "18", keywords: ["wire mesh", "jali", "netting", "fencing", "chain link", "barbed"] },
  { code: "7317", description: "Nails, tacks, staples of iron or steel", gstRatePct: "18", keywords: ["nail", "keel", "kil", "tack", "staple", "panel pin"] },
  { code: "7318", description: "Screws, bolts, nuts, washers of iron or steel", gstRatePct: "18", keywords: ["screw", "bolt", "nut", "washer", "anchor", "fastener", "peech", "stud", "rawal plug"] },
  { code: "7324", description: "Sanitary ware of iron or steel (sinks)", gstRatePct: "18", keywords: ["steel sink", "kitchen sink", "ss sink"] },
  { code: "7326", description: "Other articles of iron or steel (clamps, brackets)", gstRatePct: "18", keywords: ["clamp", "bracket", "hook", "steel item", "chain"] },

  // ── Hardware fittings & locks ──
  { code: "8301", description: "Padlocks & locks, keys of base metal", gstRatePct: "18", keywords: ["lock", "padlock", "tala", "door lock", "key", "latch lock", "mortise"] },
  { code: "8302", description: "Base metal fittings — hinges, handles, door fittings", gstRatePct: "18", keywords: ["hinge", "kabza", "handle", "door fitting", "tower bolt", "aldrop", "stopper", "bracket", "channel slide"] },
  { code: "8311", description: "Welding rods & electrodes", gstRatePct: "18", keywords: ["welding rod", "electrode", "welding"] },

  // ── Plastics & PVC ──
  { code: "3917", description: "Tubes, pipes & fittings of plastic (PVC, CPVC, UPVC)", gstRatePct: "18", keywords: ["pvc pipe", "cpvc", "upvc", "plastic pipe", "elbow", "tee", "coupler", "fitting", "bend", "socket"] },
  { code: "3922", description: "Plastic baths, wash basins, WC seats, cisterns", gstRatePct: "18", keywords: ["wc seat", "cistern", "plastic basin", "flush tank", "seat cover"] },
  { code: "3925", description: "Builders' ware of plastic (water tanks, doors)", gstRatePct: "18", keywords: ["water tank", "tank", "sintex", "pvc door", "plastic door"] },
  { code: "3926", description: "Other articles of plastic", gstRatePct: "18", keywords: ["plastic item", "plastic clamp", "plastic sheet"] },

  // ── Sanitaryware, tiles, glass, wood ──
  { code: "6910", description: "Ceramic sinks, wash basins, WC pans, sanitary fixtures", gstRatePct: "18", keywords: ["wash basin", "basin", "commode", "wc", "toilet", "sanitary", "urinal", "ceramic sink"] },
  { code: "6907", description: "Ceramic & vitrified tiles", gstRatePct: "18", keywords: ["tile", "tiles", "vitrified", "ceramic tile", "floor tile", "wall tile"] },
  { code: "7007", description: "Safety glass (toughened, laminated)", gstRatePct: "18", keywords: ["toughened glass", "safety glass", "laminated glass"] },
  { code: "7005", description: "Float glass & surface-ground glass (sheet)", gstRatePct: "18", keywords: ["glass", "glass sheet", "mirror glass", "float glass"] },
  { code: "7009", description: "Glass mirrors", gstRatePct: "18", keywords: ["mirror", "sheesha", "looking glass"] },
  { code: "4407", description: "Wood sawn lengthwise (timber, planks)", gstRatePct: "18", keywords: ["wood", "timber", "plank", "lakdi", "patra"] },
  { code: "4412", description: "Plywood, veneered panels, laminated wood", gstRatePct: "18", keywords: ["plywood", "ply", "board", "block board", "mdf", "veneer", "sunmica", "laminate"] },
  { code: "4418", description: "Builders' joinery & carpentry of wood (doors, frames)", gstRatePct: "18", keywords: ["wooden door", "door frame", "chaukhat", "window frame"] },

  // ── Electricals ──
  { code: "8544", description: "Insulated wire & cable", gstRatePct: "18", keywords: ["wire", "cable", "electric wire", "copper wire", "tar", "flexible cable", "submersible cable"] },
  { code: "8536", description: "Switches, sockets, MCBs, holders (below 1000 V)", gstRatePct: "18", keywords: ["switch", "socket", "mcb", "holder", "plug", "board", "modular", "distribution box", "changeover"] },
  { code: "8537", description: "Boards & panels with electrical apparatus", gstRatePct: "18", keywords: ["panel", "db box", "control panel", "distribution board"] },
  { code: "9405", description: "Lamps & lighting fittings (LED bulbs, tubes, fixtures)", gstRatePct: "18", keywords: ["led", "bulb", "light", "tube light", "lamp", "fitting", "panel light", "flood light", "batten"] },
  { code: "8504", description: "Transformers, inverters, stabilisers, chargers", gstRatePct: "18", keywords: ["inverter", "stabilizer", "stabiliser", "transformer", "charger", "ups"] },
  { code: "8507", description: "Electric accumulators (batteries)", gstRatePct: "18", keywords: ["battery", "inverter battery", "accumulator"] },
  { code: "8414", description: "Air pumps, fans, ventilating hoods", gstRatePct: "18", keywords: ["fan", "exhaust fan", "ceiling fan", "blower", "ventilator"] },
  { code: "8413", description: "Pumps for liquids (water pumps, submersible)", gstRatePct: "18", keywords: ["pump", "water pump", "submersible", "motor pump", "monoblock"] },
  { code: "8481", description: "Taps, cocks, valves for pipes & tanks", gstRatePct: "18", keywords: ["tap", "valve", "cock", "bib cock", "ball valve", "stop cock", "nal", "mixer", "faucet"] },

  // ── Tools ──
  { code: "8205", description: "Hand tools (spanners, hammers, chisels, pliers)", gstRatePct: "18", keywords: ["hand tool", "spanner", "hammer", "hathoda", "chisel", "plier", "screwdriver", "wrench", "vice", "file"] },
  { code: "8202", description: "Hand saws & saw blades", gstRatePct: "18", keywords: ["saw", "hacksaw", "blade", "aari", "saw blade"] },
  { code: "8207", description: "Interchangeable tools (drill bits, cutting tools)", gstRatePct: "18", keywords: ["drill bit", "bit", "cutter", "core bit", "hole saw"] },
  { code: "8467", description: "Power tools (drills, grinders, cutters)", gstRatePct: "18", keywords: ["drill machine", "grinder", "power tool", "cutter machine", "angle grinder", "drill"] },
  { code: "8203", description: "Files, rasps, pincers, metal cutting shears", gstRatePct: "18", keywords: ["shear", "pincer", "tin cutter", "rasp"] },
  { code: "9603", description: "Brooms, brushes (paint brushes, rollers)", gstRatePct: "18", keywords: ["brush", "paint brush", "roller", "broom", "jhadu"] },
  { code: "8201", description: "Hand tools of agriculture/horticulture (spades, pickaxes)", gstRatePct: "5", keywords: ["spade", "phawda", "pickaxe", "gainti", "trowel", "karni", "sickle"] },

  // ── Misc consumables ──
  { code: "5607", description: "Twine, cordage, ropes & cables", gstRatePct: "18", keywords: ["rope", "rassi", "twine", "nylon rope", "cord"] },
  { code: "6805", description: "Abrasive powder/grain on a base (emery, sandpaper)", gstRatePct: "18", keywords: ["sandpaper", "emery", "abrasive", "rehgmal", "sand paper"] },
  { code: "6804", description: "Millstones, grinding wheels & cutting discs", gstRatePct: "18", keywords: ["cutting disc", "grinding wheel", "wheel", "disc"] },
  { code: "3919", description: "Self-adhesive plastic tape", gstRatePct: "18", keywords: ["tape", "insulation tape", "ptfe", "teflon tape", "masking tape", "cello tape"] },
  { code: "4016", description: "Articles of vulcanised rubber (washers, gaskets)", gstRatePct: "18", keywords: ["rubber", "gasket", "rubber washer", "o ring", "rubber sheet"] },
  { code: "7607", description: "Aluminium foil / sheet", gstRatePct: "18", keywords: ["aluminium", "aluminum", "foil", "aluminium sheet"] },
  { code: "7610", description: "Aluminium structures (doors, windows, frames)", gstRatePct: "18", keywords: ["aluminium window", "aluminium door", "aluminium section", "aluminium frame"] },
];

export interface HsnSuggestion extends HsnEntry {
  /** Higher is a better match. Only used to order results. */
  score: number;
}

/**
 * Rank HSN headings against a free-text item name. Matching is deliberately simple and
 * offline (no API, no per-keystroke cost): exact keyword hit > keyword prefix > the
 * query appearing inside the description.
 *
 * Returns `[]` for a query under 2 characters, and never invents a code — an unmatched
 * item just leaves HSN blank, which is a valid invoice for a small shop.
 */
export function searchHsn(query: string, limit = 8): HsnSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  // Match on the whole query AND on its individual words, so "ultratech cement 50kg"
  // still finds "cement" — shop item names are rarely just the bare noun.
  const words = q.split(/[\s,\-/()]+/).filter((w) => w.length >= 3);
  const out: HsnSuggestion[] = [];

  for (const entry of HSN_CATALOG) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (q === kw) score = Math.max(score, 100);
      else if (q.includes(kw)) score = Math.max(score, 80 + kw.length);
      else if (kw.startsWith(q)) score = Math.max(score, 60);
      else if (words.some((w) => w === kw)) score = Math.max(score, 70);
      else if (words.some((w) => kw.startsWith(w) || w.startsWith(kw))) score = Math.max(score, 40);
    }
    if (score === 0 && entry.description.toLowerCase().includes(q)) score = 30;
    if (score === 0 && entry.code === q) score = 100;
    if (score > 0) out.push({ ...entry, score });
  }

  return out.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit);
}
