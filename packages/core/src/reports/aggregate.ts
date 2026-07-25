// Pure, DB-free report aggregation (03 §8 GST; 13 reports note). These functions
// take already-loaded Invoice / InvoiceLine / CreditNote rows (as plain Decimal-ish
// shapes) and fold them into GSTR-1 sections, the HSN summary, and the day-end /
// sales roll-ups. They are the load-bearing money math the S7 gate grades, so they
// are kept here — no Prisma, fully unit-testable. All amounts are RUPEE Decimals in
// and out; the service converts to paise at the wire.
//
// Invariants enforced here:
//  - KACHA is excluded by construction: kacha persists no Invoice row, so nothing
//    kacha-shaped can reach these functions (13 §8).
//  - CANCELLED invoices are EXCLUDED from sales/GST totals (a cancelled bill is not a
//    supply); the caller must not pass them, but we defend by skipping status.
//  - A B2B supply has a customer GSTIN; everything else is B2C. CGST+SGST when
//    igstTotal == 0, else IGST (place-of-supply already decided at invoice time).
import Decimal from "decimal.js";

const D = (v: Decimal.Value): Decimal => new Decimal(v);
const ZERO = new Decimal(0);

// ─────────────────── Shared input shapes (Decimal-ish, framework-free) ───────────────────
export interface ReportLine {
  hsnCode: string | null;
  baseQty: Decimal.Value; // signed in DB but always + for a sale line
  saleQty: Decimal.Value;
  taxableValue: Decimal.Value;
  gstRate: Decimal.Value; // percent
  cgst: Decimal.Value;
  sgst: Decimal.Value;
  igst: Decimal.Value;
  /** Base unit code for the HSN UQC (unit quantity code) column; optional. */
  baseUnitCode?: string | null;
}

export interface ReportInvoice {
  id: string;
  invoiceNo: string;
  date: Date;
  status: "ACTIVE" | "CANCELLED";
  placeOfSupplyState: string;
  customerGstin: string | null;
  customerName: string | null;
  taxableTotal: Decimal.Value;
  cgstTotal: Decimal.Value;
  sgstTotal: Decimal.Value;
  igstTotal: Decimal.Value;
  roundOff: Decimal.Value;
  grandTotal: Decimal.Value;
  /** Distinct payment modes recorded against the invoice (for sales-by-mode). */
  paymentModes: string[];
  lines: ReportLine[];
}

export interface ReportCreditNote {
  id: string;
  creditNoteNo: string;
  createdAt: Date;
  invoiceNo: string;
  invoiceDate: Date;
  customerGstin: string | null;
  placeOfSupplyState: string;
  taxableTotal: Decimal.Value;
  cgstTotal: Decimal.Value;
  sgstTotal: Decimal.Value;
  igstTotal: Decimal.Value;
  grandTotal: Decimal.Value;
  lines: { hsnCode: string | null; baseQty: Decimal.Value; taxableValue: Decimal.Value; gstRate: Decimal.Value; cgst: Decimal.Value; sgst: Decimal.Value; igst: Decimal.Value; baseUnitCode?: string | null }[];
}

// ─────────────────── GSTR-1 ───────────────────
export interface Gstr1InvoiceRow {
  invoiceNo: string;
  date: string; // YYYY-MM-DD
  gstin: string | null;
  customerName: string | null;
  placeOfSupplyState: string;
  taxableValue: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  invoiceValue: Decimal;
}
export interface Gstr1CreditNoteRow {
  creditNoteNo: string;
  date: string;
  originalInvoiceNo: string;
  gstin: string | null;
  placeOfSupplyState: string;
  taxableValue: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  noteValue: Decimal;
}
export interface HsnSummaryRow {
  hsnCode: string;
  uqc: string; // unit quantity code (base unit)
  totalQty: Decimal;
  taxableValue: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}
export interface Gstr1Aggregate {
  period: string;
  b2b: Gstr1InvoiceRow[]; // supplies to GSTIN-holders
  b2c: Gstr1InvoiceRow[]; // supplies to unregistered (no GSTIN)
  creditNotes: Gstr1CreditNoteRow[];
  hsn: HsnSummaryRow[];
  totals: {
    b2bTaxable: Decimal;
    b2cTaxable: Decimal;
    cnTaxable: Decimal;
    cgst: Decimal;
    sgst: Decimal;
    igst: Decimal;
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fold ACTIVE pakka invoices + credit notes into the GSTR-1 sections (04 Reports).
 * B2B = customer has a GSTIN; B2C = no GSTIN. The HSN summary aggregates every
 * invoice line by (hsnCode, base-unit UQC). Cancelled invoices are skipped (not a
 * supply). Returns rupee Decimals; the service paise-ifies for the wire / CSV.
 */
export function buildGstr1(
  period: string,
  invoices: ReportInvoice[],
  creditNotes: ReportCreditNote[],
): Gstr1Aggregate {
  const b2b: Gstr1InvoiceRow[] = [];
  const b2c: Gstr1InvoiceRow[] = [];
  const hsnMap = new Map<string, HsnSummaryRow>();

  let b2bTaxable = ZERO;
  let b2cTaxable = ZERO;
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;

  const addHsn = (
    hsn: string | null,
    uqc: string | null,
    qty: Decimal.Value,
    taxable: Decimal.Value,
    c: Decimal.Value,
    s: Decimal.Value,
    i: Decimal.Value,
  ) => {
    const code = (hsn && hsn.trim()) || "UNCLASSIFIED";
    const key = `${code}::${uqc ?? "NA"}`;
    const existing = hsnMap.get(key);
    if (existing) {
      existing.totalQty = existing.totalQty.plus(qty);
      existing.taxableValue = existing.taxableValue.plus(taxable);
      existing.cgst = existing.cgst.plus(c);
      existing.sgst = existing.sgst.plus(s);
      existing.igst = existing.igst.plus(i);
    } else {
      hsnMap.set(key, {
        hsnCode: code,
        uqc: uqc ?? "NA",
        totalQty: D(qty),
        taxableValue: D(taxable),
        cgst: D(c),
        sgst: D(s),
        igst: D(i),
      });
    }
  };

  for (const inv of invoices) {
    if (inv.status === "CANCELLED") continue;
    const row: Gstr1InvoiceRow = {
      invoiceNo: inv.invoiceNo,
      date: ymd(inv.date),
      gstin: inv.customerGstin,
      customerName: inv.customerName,
      placeOfSupplyState: inv.placeOfSupplyState,
      taxableValue: D(inv.taxableTotal),
      cgst: D(inv.cgstTotal),
      sgst: D(inv.sgstTotal),
      igst: D(inv.igstTotal),
      invoiceValue: D(inv.grandTotal),
    };
    if (inv.customerGstin && inv.customerGstin.trim().length > 0) {
      b2b.push(row);
      b2bTaxable = b2bTaxable.plus(row.taxableValue);
    } else {
      b2c.push(row);
      b2cTaxable = b2cTaxable.plus(row.taxableValue);
    }
    cgst = cgst.plus(row.cgst);
    sgst = sgst.plus(row.sgst);
    igst = igst.plus(row.igst);

    for (const l of inv.lines) {
      addHsn(l.hsnCode, l.baseUnitCode ?? null, l.baseQty, l.taxableValue, l.cgst, l.sgst, l.igst);
    }
  }

  // Credit notes reduce the supply; their HSN qty/value are SUBTRACTED so the HSN
  // summary nets the period (a return reverses what was billed).
  const cnRows: Gstr1CreditNoteRow[] = [];
  let cnTaxable = ZERO;
  for (const cn of creditNotes) {
    cnRows.push({
      creditNoteNo: cn.creditNoteNo,
      date: ymd(cn.createdAt),
      originalInvoiceNo: cn.invoiceNo,
      gstin: cn.customerGstin,
      placeOfSupplyState: cn.placeOfSupplyState,
      taxableValue: D(cn.taxableTotal),
      cgst: D(cn.cgstTotal),
      sgst: D(cn.sgstTotal),
      igst: D(cn.igstTotal),
      noteValue: D(cn.grandTotal),
    });
    cnTaxable = cnTaxable.plus(D(cn.taxableTotal));
    cgst = cgst.minus(D(cn.cgstTotal));
    sgst = sgst.minus(D(cn.sgstTotal));
    igst = igst.minus(D(cn.igstTotal));
    for (const l of cn.lines) {
      addHsn(
        l.hsnCode,
        l.baseUnitCode ?? null,
        D(l.baseQty).negated(),
        D(l.taxableValue).negated(),
        D(l.cgst).negated(),
        D(l.sgst).negated(),
        D(l.igst).negated(),
      );
    }
  }

  const hsn = [...hsnMap.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));

  return {
    period,
    b2b,
    b2c,
    creditNotes: cnRows,
    hsn,
    totals: { b2bTaxable, b2cTaxable, cnTaxable, cgst, sgst, igst },
  };
}

// ─────────────────── Day-end summary (pakka only) ───────────────────
export interface DayEndSummary {
  date: string;
  invoiceCount: number;
  cancelledCount: number;
  taxableTotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
  roundOffTotal: Decimal;
  grandTotal: Decimal;
  byPaymentMode: { mode: string; amount: Decimal; count: number }[];
  creditNoteCount: number;
  creditNoteTotal: Decimal;
}

/**
 * Day-end roll-up over the day's pakka invoices (kacha EXCLUDED — no rows exist;
 03 §6, 14 Chunk 11). Cancelled invoices are counted but contribute nothing to the
 * money totals. `byPaymentMode` distributes each invoice's grand total across its
 * recorded payment modes (a part-cash/part-khata bill counts toward each). Pure.
 */
export function buildDayEnd(
  date: string,
  invoices: ReportInvoice[],
  paymentsByMode: { mode: string; amount: Decimal.Value }[],
  creditNotes: { grandTotal: Decimal.Value }[],
): DayEndSummary {
  let taxable = ZERO;
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;
  let roundOff = ZERO;
  let grand = ZERO;
  let cancelled = 0;
  let active = 0;

  for (const inv of invoices) {
    if (inv.status === "CANCELLED") {
      cancelled++;
      continue;
    }
    active++;
    taxable = taxable.plus(D(inv.taxableTotal));
    cgst = cgst.plus(D(inv.cgstTotal));
    sgst = sgst.plus(D(inv.sgstTotal));
    igst = igst.plus(D(inv.igstTotal));
    roundOff = roundOff.plus(D(inv.roundOff));
    grand = grand.plus(D(inv.grandTotal));
  }

  const modeMap = new Map<string, { amount: Decimal; count: number }>();
  for (const p of paymentsByMode) {
    const e = modeMap.get(p.mode) ?? { amount: ZERO, count: 0 };
    e.amount = e.amount.plus(D(p.amount));
    e.count += 1;
    modeMap.set(p.mode, e);
  }

  const cnTotal = creditNotes.reduce((a, c) => a.plus(D(c.grandTotal)), ZERO);

  return {
    date,
    invoiceCount: active,
    cancelledCount: cancelled,
    taxableTotal: taxable,
    cgstTotal: cgst,
    sgstTotal: sgst,
    igstTotal: igst,
    roundOffTotal: roundOff,
    grandTotal: grand,
    byPaymentMode: [...modeMap.entries()].map(([mode, v]) => ({ mode, amount: v.amount, count: v.count })),
    creditNoteCount: creditNotes.length,
    creditNoteTotal: cnTotal,
  };
}

// ─────────────────── CSV serialisation (GSTR-1) ───────────────────
/** Quote a CSV field iff it contains a comma, quote, or newline (RFC-4180). */
function csvField(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cells: (string | number)[]): string {
  return cells.map(csvField).join(",");
}

/** Convert a rupee Decimal to a fixed 2dp string for CSV (filing wants rupees). */
function r2(v: Decimal): string {
  return v.toFixed(2);
}

/**
 * Serialise a GSTR-1 aggregate to CSV — the four sections (B2B, B2C, Credit Notes,
 * HSN summary) concatenated with section headers, matching the layout an accountant
 * uploads. Amounts are RUPEES (2dp) here (GST portal convention), not paise.
 */
export function gstr1ToCsv(agg: Gstr1Aggregate): string {
  const lines: string[] = [];
  lines.push(`# GSTR-1 export for ${agg.period}`);

  lines.push("");
  lines.push("## B2B (registered customers)");
  lines.push(csvRow(["InvoiceNo", "Date", "GSTIN", "Customer", "PlaceOfSupply", "Taxable", "CGST", "SGST", "IGST", "InvoiceValue"]));
  for (const r of agg.b2b) {
    lines.push(csvRow([r.invoiceNo, r.date, r.gstin ?? "", r.customerName ?? "", r.placeOfSupplyState, r2(r.taxableValue), r2(r.cgst), r2(r.sgst), r2(r.igst), r2(r.invoiceValue)]));
  }

  lines.push("");
  lines.push("## B2C (unregistered customers)");
  lines.push(csvRow(["InvoiceNo", "Date", "PlaceOfSupply", "Taxable", "CGST", "SGST", "IGST", "InvoiceValue"]));
  for (const r of agg.b2c) {
    lines.push(csvRow([r.invoiceNo, r.date, r.placeOfSupplyState, r2(r.taxableValue), r2(r.cgst), r2(r.sgst), r2(r.igst), r2(r.invoiceValue)]));
  }

  lines.push("");
  lines.push("## Credit Notes");
  lines.push(csvRow(["CreditNoteNo", "Date", "OriginalInvoice", "GSTIN", "PlaceOfSupply", "Taxable", "CGST", "SGST", "IGST", "NoteValue"]));
  for (const r of agg.creditNotes) {
    lines.push(csvRow([r.creditNoteNo, r.date, r.originalInvoiceNo, r.gstin ?? "", r.placeOfSupplyState, r2(r.taxableValue), r2(r.cgst), r2(r.sgst), r2(r.igst), r2(r.noteValue)]));
  }

  lines.push("");
  lines.push("## HSN Summary");
  lines.push(csvRow(["HSN", "UQC", "TotalQty", "Taxable", "CGST", "SGST", "IGST"]));
  for (const r of agg.hsn) {
    lines.push(csvRow([r.hsnCode, r.uqc, r.totalQty.toFixed(3), r2(r.taxableValue), r2(r.cgst), r2(r.sgst), r2(r.igst)]));
  }

  return lines.join("\n") + "\n";
}
