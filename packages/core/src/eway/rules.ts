// e-Way bill rules — thresholds, validity and document-age limits (doc 20 §7).
//
// Unlike e-invoicing (mandatory only above ₹5 crore turnover), an e-way bill is
// required by ANY business moving goods above a value threshold. That makes this the
// compliance feature our shops actually need today.
//
// EVERYTHING HERE IS A DEFAULT, NOT A TRUTH. State governments change intra-state
// thresholds by their own notification with no central announcement (West Bengal moved
// to ₹50,000 in June 2026). So the numbers below are starting values a shop can
// override, and the UI always says which threshold it applied.

/** Money is integer paise throughout (04 §2). ₹50,000 = 5,000,000 paise. */
const LAKH = 10_000_000; // ₹1,00,000 in paise
const FIFTY_K = 5_000_000; // ₹50,000 in paise

/**
 * Inter-state movement: ₹50,000 everywhere, set by Rule 138 centrally. This one is
 * uniform and does not vary by state.
 */
export const INTERSTATE_THRESHOLD_PAISE = FIFTY_K;

/**
 * Intra-state (within one state) thresholds, by GST state code. Only states we have
 * positively verified as differing from the ₹50,000 default are listed; everything
 * else falls back.
 *
 * Deliberately biased LOW: when unsure we use ₹50,000, which warns *more* often. An
 * unnecessary prompt costs the shopkeeper a moment; a missing e-way bill costs them a
 * detained vehicle and a penalty. Over-warning is the safe direction to be wrong in.
 */
export const INTRASTATE_THRESHOLDS_PAISE: Readonly<Record<string, number>> = {
  "10": LAKH, // Bihar
  "27": LAKH, // Maharashtra
  "33": LAKH, // Tamil Nadu
};

/** Default when a state has no specific entry above. */
export const DEFAULT_INTRASTATE_THRESHOLD_PAISE = FIFTY_K;

export interface ThresholdDecision {
  /** True when a bill is needed for this consignment. */
  required: boolean;
  /** The threshold actually applied, in paise — shown in the UI so it is auditable. */
  thresholdPaise: number;
  /** Whether the movement crossed a state border. */
  interState: boolean;
  /** Set when the shop overrode the default. */
  overridden: boolean;
}

/**
 * Decide whether a consignment needs an e-way bill.
 *
 * `overridePaise` lets a shop set the figure their own state actually uses — the
 * escape hatch for the fact that these move without notice.
 */
export function ewayBillRequired(args: {
  consignmentValuePaise: number;
  fromStateCode: string;
  toStateCode: string;
  overridePaise?: number | null;
}): ThresholdDecision {
  const interState = args.fromStateCode !== args.toStateCode;
  const base = interState
    ? INTERSTATE_THRESHOLD_PAISE
    : (INTRASTATE_THRESHOLDS_PAISE[args.toStateCode] ?? DEFAULT_INTRASTATE_THRESHOLD_PAISE);

  const overridden = args.overridePaise != null && args.overridePaise > 0;
  const thresholdPaise = overridden ? args.overridePaise! : base;

  return {
    // Rule 138 says "exceeds" — a consignment exactly AT the threshold does not need one.
    required: args.consignmentValuePaise > thresholdPaise,
    thresholdPaise,
    interState,
    overridden,
  };
}

/**
 * Validity in days for a distance.
 *
 * Rule 138(10): one day for up to 200 km, plus one more day for every additional 200 km
 * "or part thereof". Over-dimensional cargo (and multimodal shipments with a ship leg)
 * validate far more slowly — one day per 20 km.
 *
 * Raised from 100 km to 200 km by Notification 94/2020-CT, effective 1 Jan 2021.
 */
export function validityDays(distanceKm: number, overDimensional = false): number {
  const perDay = overDimensional ? 20 : 200;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 1;
  return Math.max(1, Math.ceil(distanceKm / perDay));
}

/**
 * When the bill expires. Validity runs from when **Part-B (the vehicle) is first
 * entered**, not from when Part-A was created — a consignment sitting on the dock is
 * not yet in transit. Expiry is midnight at the END of the final day.
 */
export function validUntil(partBEnteredAt: Date, distanceKm: number, overDimensional = false): Date {
  const days = validityDays(distanceKm, overDimensional);
  const end = new Date(partBEnteredAt);
  // "A day" here means up to midnight of the following day, so add the day count and
  // then run to the end of that date.
  end.setUTCDate(end.getUTCDate() + days);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * From 1 January 2025 an e-way bill cannot be generated against a document older than
 * 180 days. We surface this BEFORE the shopkeeper fills in transport details, rather
 * than letting the portal reject it after the work.
 */
export const MAX_DOCUMENT_AGE_DAYS = 180;

export function documentTooOld(documentDate: Date, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - documentDate.getTime();
  return ageMs > MAX_DOCUMENT_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * An e-way bill may be cancelled within 24 hours of generation — unless it has already
 * been verified in transit by an officer, which we cannot know from here. So this is a
 * necessary condition, not a sufficient one; the portal is the final authority.
 */
export const CANCEL_WINDOW_HOURS = 24;

export function withinCancelWindow(generatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - generatedAt.getTime() <= CANCEL_WINDOW_HOURS * 60 * 60 * 1000;
}

/** Transport modes, in the portal's numeric coding. */
export const TRANSPORT_MODE_CODE: Readonly<Record<string, string>> = {
  ROAD: "1",
  RAIL: "2",
  AIR: "3",
  SHIP: "4",
};

/** Supply/document type codes the e-way bill payload expects. */
export const EWB_DOC_TYPE = "INV" as const;
export const EWB_SUPPLY_TYPE_OUTWARD = "O" as const;
export const EWB_SUB_SUPPLY_SUPPLY = "1" as const;
