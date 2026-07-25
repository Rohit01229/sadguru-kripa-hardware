// Reports (S7; 04 Reports, 03 §8, 13 reports note). READ-ONLY — this module NEVER
// mutates (03 §3: reports read across modules, mutate nothing). Every report is a
// QUERY/VIEW over Invoice + InvoiceLine (+ CreditNote) — NOT a new table (13 reports
// note). KACHA is excluded by construction: a kacha sale persists no Invoice row, so
// nothing kacha-shaped is queryable here (03 §6).
//
//  salesReport     — active pakka sales grouped by day / item / category / paymentMode.
//  dayEnd          — one day's pakka roll-up (kacha excluded; cancelled counted, not summed).
//  gstr1           — B2B / B2C / credit-note sections + HSN summary, JSON or CSV.
//  stockValuation  — on-hand × cost per base unit, across the catalog.
//  listAudit       — append-only audit-log browser (audit.read), the only "report"
//                    that is access-gated at the service (it exposes who-did-what).
//
// Permissions (reports.read / reports.export / audit.read) are enforced at TRANSPORT
// (route handler), matching the other read services in this codebase (listStock,
// listInvoices, …). The pure aggregation math lives in ./aggregate (unit-tested).
import Decimal from "decimal.js";
import { type Prisma, prisma } from "../shared/db";
import { toPaise } from "../shared/money";
import type { Id } from "../shared/types";
import {
  salesReportQuerySchema,
  dayEndQuerySchema,
  gstr1QuerySchema,
  stockValuationQuerySchema,
  auditQuerySchema,
  type SalesReportQuery,
  type DayEndQuery,
  type Gstr1Query,
  type StockValuationQuery,
  type AuditQuery,
} from "./schema";
import {
  buildGstr1,
  buildDayEnd,
  gstr1ToCsv,
  type ReportInvoice,
  type ReportCreditNote,
  type Gstr1Aggregate,
} from "./aggregate";

// ─────────────────── Date helpers (UTC day boundaries) ───────────────────
/** Start of the given YYYY-MM-DD day (UTC). */
function dayStart(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}
/** Exclusive end of the given YYYY-MM-DD day (UTC) = start of the next day. */
function dayEndExclusive(d: string): Date {
  const start = dayStart(d);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}
/** Today as YYYY-MM-DD (UTC). */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
/** [start, endExclusive) for a YYYY-MM period (whole calendar month, UTC). */
function periodRange(period: string): { start: Date; endExclusive: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(y!, m!, 1, 0, 0, 0)); // first of next month
  return { start, endExclusive };
}

// The invoice shape every report loads (status + tax heads + lines + payments).
// InvoiceLine has no `product` relation (13 §8), so the per-line base-unit UQC for the
// HSN summary is looked up from a productId→baseUnitCode map the caller builds once.
const reportInvoiceInclude = {
  lines: true,
  payments: { select: { mode: true } },
} satisfies Prisma.InvoiceInclude;

type ReportInvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof reportInvoiceInclude }>;

/**
 * Build a productId → base-unit code map for the invoices' line products, in one
 * query, so the HSN summary can carry the UQC without an InvoiceLine→Product relation.
 */
async function baseUnitMapFor(productIds: string[]): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(productIds)] } },
    select: { id: true, baseUnit: { select: { code: true } } },
  });
  return new Map(products.map((p) => [p.id, p.baseUnit.code]));
}

/** Map a loaded Prisma invoice row into the pure-aggregator ReportInvoice shape. */
function toReportInvoice(inv: ReportInvoiceRow, baseUnits: Map<string, string>): ReportInvoice {
  return {
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    date: inv.date,
    status: inv.status,
    placeOfSupplyState: inv.placeOfSupplyState,
    customerGstin: inv.customerGstinSnap,
    customerName: inv.customerNameSnap,
    taxableTotal: inv.taxableTotal,
    cgstTotal: inv.cgstTotal,
    sgstTotal: inv.sgstTotal,
    igstTotal: inv.igstTotal,
    roundOff: inv.roundOff,
    grandTotal: inv.grandTotal,
    paymentModes: [...new Set(inv.payments.map((p) => p.mode))],
    lines: inv.lines.map((l) => ({
      hsnCode: l.hsnCode,
      baseQty: l.baseQty,
      saleQty: l.saleQty,
      taxableValue: l.taxableValue,
      gstRate: l.gstRate,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
      baseUnitCode: baseUnits.get(l.productId) ?? null,
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Sales report — day / item / category / payment-mode.
// ════════════════════════════════════════════════════════════════════════════
export interface SalesGroupRow {
  key: string; // day (YYYY-MM-DD) | productId | categoryId | mode
  label: string; // human label
  qty: string | null; // summed base qty (item/category only)
  taxable: number; // paise
  tax: number; // paise (cgst+sgst+igst)
  total: number; // paise (grand for day/mode; line total for item/category)
  count: number; // invoices (day/mode) or lines (item/category)
}
export interface SalesReportDTO {
  from: string;
  to: string;
  groupBy: "day" | "item" | "category" | "paymentMode";
  rows: SalesGroupRow[];
  totals: { taxable: number; tax: number; total: number; invoiceCount: number };
}

/**
 * Sales report over ACTIVE pakka invoices in [from, to] (inclusive days). Grouped
 * by day / item / category / payment-mode. Cancelled invoices and kacha are excluded
 * (kacha has no rows). Money is paise on the wire. Read-only.
 */
export async function salesReport(query: SalesReportQuery = {}): Promise<SalesReportDTO> {
  const { from, to, groupBy } = salesReportQuerySchema.parse(query);
  const toDay = to ?? todayYmd();
  const fromDay = from ?? toDay;

  const where: Prisma.InvoiceWhereInput = {
    status: "ACTIVE",
    date: { gte: dayStart(fromDay), lt: dayEndExclusive(toDay) },
  };

  const invoices = await prisma.invoice.findMany({
    where,
    include: reportInvoiceInclude,
    orderBy: { date: "asc" },
  });

  const D = (v: Decimal.Value) => new Decimal(v);
  let totTaxable = new Decimal(0);
  let totTax = new Decimal(0);
  let totTotal = new Decimal(0);

  const rows: SalesGroupRow[] = [];

  if (groupBy === "day" || groupBy === "paymentMode") {
    const map = new Map<string, { taxable: Decimal; tax: Decimal; total: Decimal; count: number; label: string }>();
    for (const inv of invoices) {
      const tax = D(inv.cgstTotal).plus(inv.sgstTotal).plus(inv.igstTotal);
      totTaxable = totTaxable.plus(inv.taxableTotal);
      totTax = totTax.plus(tax);
      totTotal = totTotal.plus(inv.grandTotal);

      if (groupBy === "day") {
        const key = inv.date.toISOString().slice(0, 10);
        const e = map.get(key) ?? { taxable: new Decimal(0), tax: new Decimal(0), total: new Decimal(0), count: 0, label: key };
        e.taxable = e.taxable.plus(inv.taxableTotal);
        e.tax = e.tax.plus(tax);
        e.total = e.total.plus(inv.grandTotal);
        e.count += 1;
        map.set(key, e);
      } else {
        // paymentMode: a multi-mode bill attributes its grand total to each mode it
        // recorded (and CREDIT for the unpaid khata balance). Simplest correct view:
        // distribute by the actual Payment rows; an unpaid khata bill → CREDIT bucket.
        const modes = inv.payments.length > 0 ? [...new Set(inv.payments.map((p) => p.mode))] : ["CREDIT"];
        for (const mode of modes) {
          const e = map.get(mode) ?? { taxable: new Decimal(0), tax: new Decimal(0), total: new Decimal(0), count: 0, label: mode };
          e.taxable = e.taxable.plus(inv.taxableTotal);
          e.tax = e.tax.plus(tax);
          e.total = e.total.plus(inv.grandTotal);
          e.count += 1;
          map.set(mode, e);
        }
      }
    }
    for (const [key, e] of map) {
      rows.push({ key, label: e.label, qty: null, taxable: toPaise(e.taxable), tax: toPaise(e.tax), total: toPaise(e.total), count: e.count });
    }
    rows.sort((a, b) => a.key.localeCompare(b.key));
  } else {
    // item / category: fold InvoiceLines. Resolve product → name/category once.
    const productIds = [...new Set(invoices.flatMap((i) => i.lines.map((l) => l.productId)))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, categoryId: true, category: { select: { name: true } } },
    });
    const pmap = new Map(products.map((p) => [p.id, p]));

    const map = new Map<string, { qty: Decimal; taxable: Decimal; tax: Decimal; total: Decimal; count: number; label: string }>();
    for (const inv of invoices) {
      const tax = D(inv.cgstTotal).plus(inv.sgstTotal).plus(inv.igstTotal);
      totTaxable = totTaxable.plus(inv.taxableTotal);
      totTax = totTax.plus(tax);
      totTotal = totTotal.plus(inv.grandTotal);

      for (const l of inv.lines) {
        const p = pmap.get(l.productId);
        const key = groupBy === "item" ? l.productId : (p?.categoryId ?? "uncategorised");
        const label = groupBy === "item" ? `${p?.name ?? l.productId} (${p?.sku ?? ""})`.trim() : (p?.category?.name ?? "Uncategorised");
        const lineTax = D(l.cgst).plus(l.sgst).plus(l.igst);
        const lineTotal = D(l.taxableValue).plus(lineTax);
        const e = map.get(key) ?? { qty: new Decimal(0), taxable: new Decimal(0), tax: new Decimal(0), total: new Decimal(0), count: 0, label };
        e.qty = e.qty.plus(l.baseQty);
        e.taxable = e.taxable.plus(l.taxableValue);
        e.tax = e.tax.plus(lineTax);
        e.total = e.total.plus(lineTotal);
        e.count += 1;
        map.set(key, e);
      }
    }
    for (const [key, e] of map) {
      rows.push({ key, label: e.label, qty: e.qty.toFixed(3), taxable: toPaise(e.taxable), tax: toPaise(e.tax), total: toPaise(e.total), count: e.count });
    }
    rows.sort((a, b) => b.total - a.total); // biggest sellers first
  }

  return {
    from: fromDay,
    to: toDay,
    groupBy,
    rows,
    totals: {
      taxable: toPaise(totTaxable),
      tax: toPaise(totTax),
      total: toPaise(totTotal),
      invoiceCount: invoices.filter((i) => i.status === "ACTIVE").length,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Day-end summary (pakka only; kacha excluded).
// ════════════════════════════════════════════════════════════════════════════
export interface DayEndDTO {
  date: string;
  invoiceCount: number;
  cancelledCount: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  roundOffTotal: number;
  grandTotal: number;
  byPaymentMode: { mode: string; amount: number; count: number }[];
  creditNoteCount: number;
  creditNoteTotal: number;
}

/**
 * Day-end roll-up for a single day (defaults to today). Pakka only — kacha is
 * excluded by design (no Invoice rows; 03 §6). Cancelled invoices are counted but
 * excluded from money totals. Payment-mode breakdown uses the day's actual Payment
 * rows. Read-only.
 */
export async function dayEnd(query: DayEndQuery = {}): Promise<DayEndDTO> {
  const { date } = dayEndQuerySchema.parse(query);
  const day = date ?? todayYmd();
  const start = dayStart(day);
  const endEx = dayEndExclusive(day);

  // These three day-scoped reads are independent — run them in parallel rather than
  // stacking three sequential cross-region round-trips.
  //  - invoices: the day's bills (+ lines + payment modes) for the roll-up.
  //  - payments: rows recorded on the day (by Payment.date), grouped by mode. Includes
  //    invoice payments and standalone khata receipts; both are cash actually taken.
  //  - creditNotes: the day's credit notes (count + total).
  const [invoices, payments, creditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: { date: { gte: start, lt: endEx } },
      include: reportInvoiceInclude,
    }),
    prisma.payment.findMany({
      where: { date: { gte: start, lt: endEx } },
      select: { mode: true, amount: true },
    }),
    prisma.creditNote.findMany({
      where: { createdAt: { gte: start, lt: endEx } },
      select: { grandTotal: true },
    }),
  ]);

  // Must stay after the invoices load — it derives productIds from the loaded lines.
  const baseUnits = await baseUnitMapFor(invoices.flatMap((i) => i.lines.map((l) => l.productId)));
  const summary = buildDayEnd(
    day,
    invoices.map((i) => toReportInvoice(i, baseUnits)),
    payments.map((p) => ({ mode: p.mode, amount: p.amount })),
    creditNotes.map((c) => ({ grandTotal: c.grandTotal })),
  );

  return {
    date: summary.date,
    invoiceCount: summary.invoiceCount,
    cancelledCount: summary.cancelledCount,
    taxableTotal: toPaise(summary.taxableTotal),
    cgstTotal: toPaise(summary.cgstTotal),
    sgstTotal: toPaise(summary.sgstTotal),
    igstTotal: toPaise(summary.igstTotal),
    roundOffTotal: toPaise(summary.roundOffTotal),
    grandTotal: toPaise(summary.grandTotal),
    byPaymentMode: summary.byPaymentMode.map((m) => ({ mode: m.mode, amount: toPaise(m.amount), count: m.count })),
    creditNoteCount: summary.creditNoteCount,
    creditNoteTotal: toPaise(summary.creditNoteTotal),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  GSTR-1 export (B2B / B2C / credit-notes + HSN) — JSON or CSV.
// ════════════════════════════════════════════════════════════════════════════
export interface Gstr1InvoiceDTO {
  invoiceNo: string;
  date: string;
  gstin: string | null;
  customerName: string | null;
  placeOfSupplyState: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  invoiceValue: number;
}
export interface Gstr1CreditNoteDTO {
  creditNoteNo: string;
  date: string;
  originalInvoiceNo: string;
  gstin: string | null;
  placeOfSupplyState: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  noteValue: number;
}
export interface HsnSummaryDTO {
  hsnCode: string;
  uqc: string;
  totalQty: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}
export interface Gstr1DTO {
  period: string;
  b2b: Gstr1InvoiceDTO[];
  b2c: Gstr1InvoiceDTO[];
  creditNotes: Gstr1CreditNoteDTO[];
  hsn: HsnSummaryDTO[];
  totals: { b2bTaxable: number; b2cTaxable: number; cnTaxable: number; cgst: number; sgst: number; igst: number };
}

async function loadGstr1Aggregate(period: string): Promise<Gstr1Aggregate> {
  const { start, endExclusive } = periodRange(period);

  const invoices = await prisma.invoice.findMany({
    where: { status: "ACTIVE", date: { gte: start, lt: endExclusive } },
    include: reportInvoiceInclude,
    orderBy: { date: "asc" },
  });

  const creditNotes = await prisma.creditNote.findMany({
    where: { createdAt: { gte: start, lt: endExclusive } },
    include: {
      invoice: { select: { invoiceNo: true, date: true, customerGstinSnap: true, placeOfSupplyState: true } },
      lines: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // CreditNoteLine has no product relation and no hsnCode (13 §8) — resolve HSN +
  // base-unit UQC per product in one query for the HSN net.
  const allProductIds = [
    ...invoices.flatMap((i) => i.lines.map((l) => l.productId)),
    ...creditNotes.flatMap((cn) => cn.lines.map((l) => l.productId)),
  ];
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(allProductIds)] } },
    select: { id: true, hsnCode: true, baseUnit: { select: { code: true } } },
  });
  const productMeta = new Map(products.map((p) => [p.id, { hsnCode: p.hsnCode, baseUnitCode: p.baseUnit.code }]));
  const baseUnits = new Map([...productMeta].map(([id, m]) => [id, m.baseUnitCode]));

  const reportInvoices = invoices.map((i) => toReportInvoice(i, baseUnits));
  const reportCns: ReportCreditNote[] = creditNotes.map((cn) => ({
    id: cn.id,
    creditNoteNo: cn.creditNoteNo,
    createdAt: cn.createdAt,
    invoiceNo: cn.invoice.invoiceNo,
    invoiceDate: cn.invoice.date,
    customerGstin: cn.invoice.customerGstinSnap,
    placeOfSupplyState: cn.invoice.placeOfSupplyState,
    taxableTotal: cn.taxableTotal,
    cgstTotal: cn.cgstTotal,
    sgstTotal: cn.sgstTotal,
    igstTotal: cn.igstTotal,
    grandTotal: cn.grandTotal,
    // CreditNoteLine stores taxable + gstRate but not split cgst/sgst/igst; derive the
    // tax split from the parent note's kind (IGST iff igstTotal > 0) so the HSN net is
    // correct. The note's totals carry the tax heads; per-line we re-derive for the HSN
    // summary only.
    lines: cn.lines.map((l) => {
      const isIgst = new Decimal(cn.igstTotal).gt(0);
      const rate = new Decimal(l.gstRate);
      const tax = new Decimal(l.taxableValue).times(rate).div(100);
      const meta = productMeta.get(l.productId);
      return {
        hsnCode: meta?.hsnCode ?? null,
        baseQty: l.baseQty,
        taxableValue: l.taxableValue,
        gstRate: l.gstRate,
        cgst: isIgst ? new Decimal(0) : tax.div(2),
        sgst: isIgst ? new Decimal(0) : tax.div(2),
        igst: isIgst ? tax : new Decimal(0),
        baseUnitCode: meta?.baseUnitCode ?? null,
      };
    }),
  }));

  return buildGstr1(period, reportInvoices, reportCns);
}

function gstrInvoiceToDTO(r: Gstr1Aggregate["b2b"][number]): Gstr1InvoiceDTO {
  return {
    invoiceNo: r.invoiceNo,
    date: r.date,
    gstin: r.gstin,
    customerName: r.customerName,
    placeOfSupplyState: r.placeOfSupplyState,
    taxableValue: toPaise(r.taxableValue),
    cgst: toPaise(r.cgst),
    sgst: toPaise(r.sgst),
    igst: toPaise(r.igst),
    invoiceValue: toPaise(r.invoiceValue),
  };
}

/** GSTR-1 as a typed DTO (paise on the wire). Read-only; reports.export at transport. */
export async function gstr1(query: Gstr1Query): Promise<Gstr1DTO> {
  const { period } = gstr1QuerySchema.parse(query);
  const agg = await loadGstr1Aggregate(period);
  return {
    period,
    b2b: agg.b2b.map(gstrInvoiceToDTO),
    b2c: agg.b2c.map(gstrInvoiceToDTO),
    creditNotes: agg.creditNotes.map((r) => ({
      creditNoteNo: r.creditNoteNo,
      date: r.date,
      originalInvoiceNo: r.originalInvoiceNo,
      gstin: r.gstin,
      placeOfSupplyState: r.placeOfSupplyState,
      taxableValue: toPaise(r.taxableValue),
      cgst: toPaise(r.cgst),
      sgst: toPaise(r.sgst),
      igst: toPaise(r.igst),
      noteValue: toPaise(r.noteValue),
    })),
    hsn: agg.hsn.map((r) => ({
      hsnCode: r.hsnCode,
      uqc: r.uqc,
      totalQty: r.totalQty.toFixed(3),
      taxableValue: toPaise(r.taxableValue),
      cgst: toPaise(r.cgst),
      sgst: toPaise(r.sgst),
      igst: toPaise(r.igst),
    })),
    totals: {
      b2bTaxable: toPaise(agg.totals.b2bTaxable),
      b2cTaxable: toPaise(agg.totals.b2cTaxable),
      cnTaxable: toPaise(agg.totals.cnTaxable),
      cgst: toPaise(agg.totals.cgst),
      sgst: toPaise(agg.totals.sgst),
      igst: toPaise(agg.totals.igst),
    },
  };
}

/** GSTR-1 as CSV text (the four sections concatenated). Read-only; reports.export. */
export async function gstr1Csv(query: Gstr1Query): Promise<string> {
  const { period } = gstr1QuerySchema.parse(query);
  const agg = await loadGstr1Aggregate(period);
  return gstr1ToCsv(agg);
}

// ════════════════════════════════════════════════════════════════════════════
//  Stock valuation (on-hand × cost per base unit).
// ════════════════════════════════════════════════════════════════════════════
export interface StockValuationRowDTO {
  productId: Id;
  sku: string;
  name: string;
  baseUnitCode: string;
  onHand: string;
  costPerBaseUnit: number; // paise
  value: number; // paise (onHand × cost)
}
export interface StockValuationDTO {
  rows: StockValuationRowDTO[];
  totalValue: number; // paise
  itemCount: number;
}

/**
 * On-hand valuation across the active catalog: value = onHand(base) × costPerBaseUnit.
 * Negative on-hand contributes a negative value (it is a real liability the owner
 * should see). Read-only; reports.read at transport.
 */
export async function stockValuation(query: StockValuationQuery = {}): Promise<StockValuationDTO> {
  const { inStockOnly } = stockValuationQuerySchema.parse(query);
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sku: true,
      name: true,
      costPerBaseUnit: true,
      baseUnit: { select: { code: true } },
      stock: { select: { onHand: true } },
    },
    orderBy: { name: "asc" },
  });

  const rows: StockValuationRowDTO[] = [];
  let total = new Decimal(0);
  for (const p of products) {
    const onHand = p.stock?.onHand ?? new Decimal(0);
    if (inStockOnly && new Decimal(onHand).lte(0)) continue;
    const value = new Decimal(onHand).times(p.costPerBaseUnit);
    total = total.plus(value);
    rows.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      baseUnitCode: p.baseUnit.code,
      onHand: new Decimal(onHand).toFixed(3),
      costPerBaseUnit: toPaise(p.costPerBaseUnit),
      value: toPaise(value),
    });
  }

  return { rows, totalValue: toPaise(total), itemCount: rows.length };
}

// ════════════════════════════════════════════════════════════════════════════
//  Audit log viewer (audit.read) — append-only browser.
// ════════════════════════════════════════════════════════════════════════════
export interface AuditRowDTO {
  id: Id;
  actorStaffId: string | null;
  roleAtTime: string | null;
  permissionUsed: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
}
export interface AuditPage {
  data: AuditRowDTO[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * Browse the append-only AuditLog (audit.read enforced at transport; 10 §7). Filter
 * by action / target / actor / date range; cursor-paginated by createdAt,id (DESC —
 * newest first). The log is never edited or deleted; this is the only view onto it.
 */
export async function listAudit(query: AuditQuery = {}): Promise<AuditPage> {
  const { action, targetType, targetId, actorStaffId, from, to, cursor, limit } = auditQuerySchema.parse(query);

  const where: Prisma.AuditLogWhereInput = {};
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (actorStaffId) where.actorStaffId = actorStaffId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dayStart(from);
    if (to) where.createdAt.lt = dayEndExclusive(to);
  }

  const afterId = decodeCursor(cursor);
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    data: page.map((r) => ({
      id: r.id,
      actorStaffId: r.actorStaffId,
      roleAtTime: r.roleAtTime,
      permissionUsed: r.permissionUsed,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      before: r.before,
      after: r.after,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
    })),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
    },
  };
}

// Re-export the report Zod surface + pure aggregators so transport imports validation
// and the (tested) aggregation math from @hardware/core only.
export * from "./schema";
export * from "./aggregate";
