// Single source of truth for DISPLAY formatting (design-system §2.5).
//
// Money is stored as integer paise; quantities as exact decimal strings. These
// helpers are display-only — the server stays authoritative for all money math.
// Never use formatMoney to re-derive totals, and never coerce a quantity decimal
// string to a JS number for display rounding.

const inrGrouping = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format integer paise as a ₹ amount with en-IN grouping and 2 decimals.
 *   123456            -> "₹1,234.56"
 *   12345678          -> "₹1,23,456.78"
 *   -123456           -> "-₹1,234.56"
 *   123456, {sign:true} -> "+₹1,234.56"
 */
export function formatMoney(paise: number, opts?: { sign?: boolean }): string {
  const safe = Number.isFinite(paise) ? Math.trunc(paise) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  // Build from integer parts so we never hit float rounding on the paise.
  const grouped = inrGrouping.format(rupees + fraction / 100);
  const prefix = negative ? "-" : opts?.sign && safe > 0 ? "+" : "";
  return `${prefix}₹${grouped}`;
}

/**
 * Format integer paise WITHOUT the ₹ symbol (for inputs / print columns).
 *   123456 -> "1,234.56"
 */
export function formatPaisePlain(paise: number): string {
  return formatMoney(paise).replace(/^[-+]?₹/, (m) => m.replace("₹", ""));
}

/**
 * Format an exact decimal-string quantity, trimming trailing zeros but keeping the
 * value exact (no Number() rounding). Optionally appends a unit.
 *   "12.500", "kg" -> "12.5 kg"
 *   "10.000"       -> "10"
 *   "0.250", "L"   -> "0.25 L"
 */
export function formatQty(qty: string, unit?: string): string {
  const trimmed = trimDecimalString(qty);
  return unit ? `${trimmed} ${unit}` : trimmed;
}

function trimDecimalString(value: string): string {
  if (typeof value !== "string") return String(value ?? "");
  const v = value.trim();
  if (!v.includes(".")) return v;
  // Drop trailing zeros after the decimal point, then a dangling dot.
  return v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** en-IN short date: "29 Jun 2026". Accepts a Date or ISO string. */
export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return dateFmt.format(date);
}

/** en-IN date + time: "29 Jun 2026, 02:30 pm". Accepts a Date or ISO string. */
export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return dateTimeFmt.format(date);
}
