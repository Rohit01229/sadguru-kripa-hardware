// Pre-sale documents (21): Estimate/Quotation, Proforma Invoice, Delivery Challan.
//
// These are the three myBillBook screens a shop reaches for BEFORE a bill exists —
// "what will it cost?", "pay in advance", "the goods are on the truck". All three are
// the same document with a different promise, so they share one table, one service and
// one print template, keyed by `kind`.
//
// The line that separates them from Billing, and why it is drawn here:
//   • They mint no invoice number. The GST series must stay gapless and every number in
//     it must correspond to a real tax invoice; a quotation that is never accepted
//     cannot be allowed to burn one.
//   • They post no tax, no ledger entry and NO STOCK MOVEMENT. Nothing has been sold.
//     Stock moves at the moment the document is converted and the bill finalises —
//     through the ordinary, already-tested finalizePakka path, not a second one.
//   • They are editable and cancellable. A finalised invoice is neither.
//
// Consequence worth stating plainly: a delivery challan does NOT reduce stock today.
// Goods can physically leave on a challan while the app still counts them as on hand.
// The alternative — decrementing here and attributing on convert — is the kacha→pakka
// dance, and getting it wrong double-deducts real inventory. Until that is built and
// tested, the challan screen says so rather than quietly reporting the wrong stock.
import Decimal from "decimal.js";
import { Prisma, prisma, runTx, type Tx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise, fromPaise } from "../shared/money";
import type { Id } from "../shared/types";
import { financialYear } from "../billing/numbering";
import { computeInvoiceTotals, type LineInput } from "../billing/totals";
import { loadLineCatalog, toBase } from "../billing/service";
import {
  createSalesDocSchema,
  updateSalesDocSchema,
  cancelSalesDocSchema,
  listSalesDocsQuerySchema,
  type CreateSalesDocInput,
  type UpdateSalesDocInput,
  type CancelSalesDocInput,
  type ListSalesDocsQuery,
  type SalesDocKind,
} from "./schema";

// ─────────────────── Permissions ───────────────────
// A pre-sale document is a weaker power than the bill it may become: anyone allowed to
// raise a tax invoice can certainly offer a price. Reusing the billing permissions
// keeps this out of the RBAC seed entirely and cannot widen anyone's access, because
// every holder already has the stronger right.
const WRITE_PERMISSION = "bill.pakka.create" as const;
const READ_PERMISSION = "bill.read" as const;

export interface SalesDocCtx {
  session: Session;
  requestId?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

function qty3(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(3));
}
function money2(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(2));
}

/** Human labels + number prefixes. The prefix is what a shopkeeper reads off the page. */
export const SALES_DOC_META: Record<
  SalesDocKind,
  { label: string; plural: string; prefix: string; slug: string }
> = {
  QUOTATION: { label: "Estimate", plural: "Estimates", prefix: "QT", slug: "estimates" },
  PROFORMA: { label: "Proforma invoice", plural: "Proforma invoices", prefix: "PI", slug: "proforma" },
  DELIVERY_CHALLAN: {
    label: "Delivery challan",
    plural: "Delivery challans",
    prefix: "DC",
    slug: "challans",
  },
};

/** slug → kind, for the /sales/<slug> routes. */
export const SALES_DOC_BY_SLUG: Record<string, SalesDocKind> = {
  estimates: "QUOTATION",
  proforma: "PROFORMA",
  challans: "DELIVERY_CHALLAN",
};

interface CounterRow {
  lastNo: number;
}

/**
 * Next document number for (shop, kind, FY) — same UPDATE … RETURNING row lock the
 * invoice counter uses, so concurrent quotes cannot collide on a number. Gaplessness
 * is not a legal requirement here (these are not tax invoices), but a rolled-back
 * transaction returning the number for free is worth having anyway.
 */
export async function nextSalesDocNo(
  tx: Tx,
  shopId: string,
  kind: SalesDocKind,
  fy: string,
): Promise<{ seq: number; docNo: string }> {
  await tx.salesDocCounter.upsert({
    where: { shopId_kind_fy: { shopId, kind, fy } },
    create: { shopId, kind, fy, lastNo: 0 },
    update: {},
  });

  const rows = await tx.$queryRaw<CounterRow[]>`
    UPDATE "SalesDocCounter"
    SET "lastNo" = "lastNo" + 1
    WHERE "shopId" = ${shopId} AND "fy" = ${fy} AND "kind" = ${kind}::"SalesDocKind"
    RETURNING "lastNo"`;

  const seq = rows[0]!.lastNo;
  return { seq, docNo: `${SALES_DOC_META[kind].prefix}/${fy}/${String(seq).padStart(6, "0")}` };
}

// ─────────────────── DTOs ───────────────────
export interface SalesDocLineDTO {
  productId: Id;
  productName: string;
  saleUnitId: Id;
  unitCode: string;
  hsnCode: string | null;
  saleQty: string;
  baseQty: string;
  unitPrice: number; // paise
  lineDiscount: number; // paise
  taxableValue: number; // paise
  gstRatePct: string;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number; // paise
}

export interface SalesDocDTO {
  id: Id;
  kind: SalesDocKind;
  kindLabel: string;
  fy: string;
  docNo: string;
  taxKind: "CGST_SGST" | "IGST";
  placeOfSupplyState: string;
  customerId: Id | null;
  customerName: string | null;
  customerPhone: string | null;
  customerGstin: string | null;
  date: string;
  validUntil: string | null;
  notes: string | null;
  lines: SalesDocLineDTO[];
  taxableTotal: number;
  discountTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  roundOff: number;
  grandTotal: number;
  status: "OPEN" | "CONVERTED" | "CANCELLED";
  cancelledReason: string | null;
  convertedInvoiceId: Id | null;
  convertedAt: string | null;
  /** Derived, never stored: a quotation past its "valid till" date. */
  isExpired: boolean;
  createdAt: string;
  updatedAt: string;
}

const salesDocInclude = {
  lines: {
    orderBy: { sortOrder: "asc" },
    include: { product: { select: { name: true } } },
  },
} satisfies Prisma.SalesDocInclude;

type SalesDocWith = Prisma.SalesDocGetPayload<{ include: typeof salesDocInclude }>;

/**
 * Sale-unit codes for display. Read separately rather than through a nested include so
 * one query covers every line of every document on a list page.
 */
async function unitCodesFor(saleUnitIds: string[]): Promise<Map<string, string>> {
  if (saleUnitIds.length === 0) return new Map();
  const rows = await prisma.productSaleUnit.findMany({
    where: { id: { in: [...new Set(saleUnitIds)] } },
    select: { id: true, unit: { select: { code: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.unit.code]));
}

function toSalesDocDTO(doc: SalesDocWith, unitCodes: Map<string, string>, now: Date): SalesDocDTO {
  return {
    id: doc.id,
    kind: doc.kind,
    kindLabel: SALES_DOC_META[doc.kind].label,
    fy: doc.fy,
    docNo: doc.docNo,
    taxKind: doc.igstTotal.gt(0) ? "IGST" : "CGST_SGST",
    placeOfSupplyState: doc.placeOfSupplyState,
    customerId: doc.customerId,
    customerName: doc.customerNameSnap,
    customerPhone: doc.customerPhoneSnap,
    customerGstin: doc.customerGstinSnap,
    date: doc.date.toISOString(),
    validUntil: doc.validUntil?.toISOString() ?? null,
    notes: doc.notes,
    lines: doc.lines.map((l) => ({
      productId: l.productId,
      productName: l.product.name,
      saleUnitId: l.saleUnitId,
      unitCode: unitCodes.get(l.saleUnitId) ?? "",
      hsnCode: l.hsnCode,
      saleQty: l.saleQty.toString(),
      baseQty: l.baseQty.toString(),
      unitPrice: toPaise(l.unitPrice),
      lineDiscount: toPaise(l.lineDiscount),
      taxableValue: toPaise(l.taxableValue),
      gstRatePct: l.gstRate.toString(),
      cgst: toPaise(l.cgst),
      sgst: toPaise(l.sgst),
      igst: toPaise(l.igst),
      lineTotal: toPaise(l.taxableValue.plus(l.cgst).plus(l.sgst).plus(l.igst)),
    })),
    taxableTotal: toPaise(doc.taxableTotal),
    discountTotal: toPaise(doc.discountTotal),
    cgstTotal: toPaise(doc.cgstTotal),
    sgstTotal: toPaise(doc.sgstTotal),
    igstTotal: toPaise(doc.igstTotal),
    roundOff: toPaise(doc.roundOff),
    grandTotal: toPaise(doc.grandTotal),
    status: doc.status,
    cancelledReason: doc.cancelledReason,
    convertedInvoiceId: doc.convertedInvoiceId,
    convertedAt: doc.convertedAt?.toISOString() ?? null,
    isExpired: doc.status === "OPEN" && doc.validUntil != null && doc.validUntil < now,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ─────────────────── Shared line pricing ───────────────────
interface PricedLines {
  rows: Omit<Prisma.SalesDocLineCreateManyInput, "salesDocId">[];
  totals: ReturnType<typeof computeInvoiceTotals>;
}

/**
 * Price a document's lines exactly the way a bill would: the SAME catalog loader, the
 * SAME UoM conversion, the SAME pure tax engine. That equality is the point — a quote
 * whose total differs from the bill it becomes is worse than no quote at all.
 */
async function priceLines(
  tx: Tx,
  shopId: string,
  input: { lines: CreateSalesDocInput["lines"]; billDiscount: number; roundOff: boolean },
  supplyState: string,
  homeState: string,
  doRound: boolean,
): Promise<PricedLines> {
  const loaded: {
    line: CreateSalesDocInput["lines"][number];
    cat: Awaited<ReturnType<typeof loadLineCatalog>>;
    baseQty: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
  }[] = [];
  const taxInputs: LineInput[] = [];

  for (const line of input.lines) {
    const cat = await loadLineCatalog(tx, shopId, line.productId, line.saleUnitId);
    const baseQty = toBase(line.quantity, cat);
    const unitPrice = line.rateOverride != null ? fromPaise(line.rateOverride) : cat.defaultPrice;
    loaded.push({ line, cat, baseQty, unitPrice });
    taxInputs.push({
      unitPrice,
      qty: new Decimal(line.quantity),
      gstRatePct: cat.gstRate,
      lineDiscount: fromPaise(line.lineDiscount ?? 0),
      priceInclusive: cat.priceInclusive,
    });
  }

  const totals = computeInvoiceTotals({
    lines: taxInputs,
    supplyState,
    homeState,
    billDiscount: fromPaise(input.billDiscount),
    roundOff: doRound,
  });

  const rows = loaded.map((l, i) => {
    const c = totals.lines[i]!;
    return {
      shopId,
      productId: l.line.productId,
      saleUnitId: l.line.saleUnitId,
      hsnCode: l.cat.hsnCode,
      saleQty: qty3(l.line.quantity),
      baseQty: l.baseQty,
      unitPrice: money2(l.unitPrice),
      lineDiscount: money2(c.discount),
      taxableValue: money2(c.taxableValue),
      gstRate: new Prisma.Decimal(c.gstRatePct.toFixed(2)),
      cgst: money2(c.cgst),
      sgst: money2(c.sgst),
      igst: money2(c.igst),
      sortOrder: i,
    };
  });

  return { rows, totals };
}

/** Home state + rounding policy, read once per operation. */
async function storeContext(shopId: string) {
  const store = await prisma.storeConfig.findUnique({
    where: { shopId },
    select: { homeState: true, gstRoundingMode: true },
  });
  if (!store) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");
  return store;
}

// ─────────────────── Create ───────────────────
export async function createSalesDoc(
  input: CreateSalesDocInput,
  ctx: SalesDocCtx,
): Promise<SalesDocDTO> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);
  const data = createSalesDocSchema.parse(input);

  const store = await storeContext(shopId);
  const supplyState = data.placeOfSupplyState?.trim() || store.homeState;
  const doRound = data.roundOff && store.gstRoundingMode !== "NONE";
  const fy = financialYear(new Date());

  const doc = await runTx(async (tx) => {
    const { docNo } = await nextSalesDocNo(tx, shopId, data.kind, fy);
    const { rows, totals } = await priceLines(
      tx,
      shopId,
      { lines: data.lines, billDiscount: data.billDiscount, roundOff: data.roundOff },
      supplyState,
      store.homeState,
      doRound,
    );

    const created = await tx.salesDoc.create({
      data: {
        shopId,
        kind: data.kind,
        fy,
        docNo,
        customerId: data.customer?.customerId ?? null,
        customerNameSnap: data.customer?.name ?? null,
        customerPhoneSnap: data.customer?.phone ?? null,
        customerGstinSnap: data.customer?.gstin ?? null,
        placeOfSupplyState: supplyState,
        // "Valid till" is a quotation concept; storing it on a challan would print a
        // meaningless date, so it is dropped for the other kinds rather than ignored
        // only at render time.
        validUntil:
          data.kind === "QUOTATION" && data.validUntil ? new Date(data.validUntil) : null,
        notes: data.notes ?? null,
        taxableTotal: money2(totals.taxableTotal),
        discountTotal: money2(totals.discountTotal),
        cgstTotal: money2(totals.cgstTotal),
        sgstTotal: money2(totals.sgstTotal),
        igstTotal: money2(totals.igstTotal),
        roundOff: money2(totals.roundOff),
        grandTotal: money2(totals.grandTotal),
        createdById: ctx.session.userId,
        lines: { createMany: { data: rows } },
      },
      include: salesDocInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "salesdoc.create",
      targetType: "SalesDoc",
      targetId: created.id,
      after: { kind: data.kind, docNo, grandTotal: created.grandTotal.toString(), lines: rows.length },
      requestId: ctx.requestId,
    });

    return created;
  });

  return toSalesDocDTO(doc, await unitCodesFor(doc.lines.map((l) => l.saleUnitId)), new Date());
}

// ─────────────────── Update (revise) ───────────────────
export async function updateSalesDoc(
  input: UpdateSalesDocInput,
  ctx: SalesDocCtx,
): Promise<SalesDocDTO> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);
  const data = updateSalesDocSchema.parse(input);

  const store = await storeContext(shopId);
  const supplyState = data.placeOfSupplyState?.trim() || store.homeState;
  const doRound = data.roundOff && store.gstRoundingMode !== "NONE";

  const doc = await runTx(async (tx) => {
    const existing = await tx.salesDoc.findFirst({
      where: { id: data.id, shopId },
      select: { id: true, kind: true, status: true, docNo: true, grandTotal: true },
    });
    if (!existing) throw new DomainError("Document not found", "NOT_FOUND");
    // A converted document is the record of what was agreed before a real bill was
    // raised. Editing it would rewrite history the invoice already relies on.
    if (existing.status !== "OPEN") {
      throw new DomainError(
        existing.status === "CONVERTED"
          ? "This has already been converted to a bill and can no longer be edited."
          : "This document is cancelled and can no longer be edited.",
        "SALESDOC_NOT_EDITABLE",
      );
    }

    const { rows, totals } = await priceLines(
      tx,
      shopId,
      { lines: data.lines, billDiscount: data.billDiscount, roundOff: data.roundOff },
      supplyState,
      store.homeState,
      doRound,
    );

    // Full replace: the persisted totals and the lines they were computed from always
    // commit together, so they cannot drift.
    await tx.salesDocLine.deleteMany({ where: { salesDocId: existing.id, shopId } });

    const updated = await tx.salesDoc.update({
      where: { id: existing.id },
      data: {
        customerId: data.customer?.customerId ?? null,
        customerNameSnap: data.customer?.name ?? null,
        customerPhoneSnap: data.customer?.phone ?? null,
        customerGstinSnap: data.customer?.gstin ?? null,
        placeOfSupplyState: supplyState,
        validUntil:
          existing.kind === "QUOTATION" && data.validUntil ? new Date(data.validUntil) : null,
        notes: data.notes ?? null,
        taxableTotal: money2(totals.taxableTotal),
        discountTotal: money2(totals.discountTotal),
        cgstTotal: money2(totals.cgstTotal),
        sgstTotal: money2(totals.sgstTotal),
        igstTotal: money2(totals.igstTotal),
        roundOff: money2(totals.roundOff),
        grandTotal: money2(totals.grandTotal),
        lines: { createMany: { data: rows } },
      },
      include: salesDocInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "salesdoc.update",
      targetType: "SalesDoc",
      targetId: existing.id,
      before: { grandTotal: existing.grandTotal.toString() },
      after: { grandTotal: updated.grandTotal.toString(), lines: rows.length },
      requestId: ctx.requestId,
    });

    return updated;
  });

  return toSalesDocDTO(doc, await unitCodesFor(doc.lines.map((l) => l.saleUnitId)), new Date());
}

// ─────────────────── Cancel ───────────────────
export async function cancelSalesDoc(
  input: CancelSalesDocInput,
  ctx: SalesDocCtx,
): Promise<SalesDocDTO> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);
  const data = cancelSalesDocSchema.parse(input);

  const doc = await runTx(async (tx) => {
    const existing = await tx.salesDoc.findFirst({
      where: { id: data.id, shopId },
      select: { id: true, status: true, docNo: true },
    });
    if (!existing) throw new DomainError("Document not found", "NOT_FOUND");
    if (existing.status === "CONVERTED") {
      throw new DomainError(
        "This has already been converted to a bill. Cancel the bill instead.",
        "SALESDOC_ALREADY_CONVERTED",
      );
    }
    if (existing.status === "CANCELLED") return null;

    const updated = await tx.salesDoc.update({
      where: { id: existing.id },
      data: { status: "CANCELLED", cancelledReason: data.reason },
      include: salesDocInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "salesdoc.cancel",
      targetType: "SalesDoc",
      targetId: existing.id,
      after: { docNo: existing.docNo, reason: data.reason },
      requestId: ctx.requestId,
    });

    return updated;
  });

  if (!doc) {
    const already = await getSalesDoc(shopId, data.id);
    if (!already) throw new DomainError("Document not found", "NOT_FOUND");
    return already;
  }
  return toSalesDocDTO(doc, await unitCodesFor(doc.lines.map((l) => l.saleUnitId)), new Date());
}

// ─────────────────── Convert → bill ───────────────────
/**
 * Stamp a document as billed. Called by the POS finalize path AFTER the invoice
 * commits — never instead of it. The `status: "OPEN"` guard in the WHERE clause is
 * what makes double-conversion impossible: two operators racing the same quote both
 * raise their own invoice, but only one `updateMany` matches, and the second is told
 * so rather than silently overwriting the first invoice's link.
 */
export async function markSalesDocConverted(
  salesDocId: Id,
  invoiceId: Id,
  ctx: SalesDocCtx,
): Promise<void> {
  requirePermission(ctx.session, WRITE_PERMISSION);
  const shopId = requireShop(ctx.session);

  await runTx(async (tx) => {
    const result = await tx.salesDoc.updateMany({
      where: { id: salesDocId, shopId, status: "OPEN" },
      data: { status: "CONVERTED", convertedInvoiceId: invoiceId, convertedAt: new Date() },
    });
    if (result.count === 0) {
      throw new DomainError(
        "That document is no longer open — it may already have been billed.",
        "SALESDOC_NOT_OPEN",
      );
    }
    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: WRITE_PERMISSION,
      action: "salesdoc.convert",
      targetType: "SalesDoc",
      targetId: salesDocId,
      after: { invoiceId },
      requestId: ctx.requestId,
    });
  });
}

// ─────────────────── Reads ───────────────────
export interface SalesDocPage {
  data: SalesDocDTO[];
  pageInfo: { hasNextPage: boolean; nextCursor: string | null };
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

export async function listSalesDocs(
  shopId: string,
  query: ListSalesDocsQuery = {},
): Promise<SalesDocPage> {
  const { kind, status, from, to, customerId, q, cursor, limit } =
    listSalesDocsQuerySchema.parse(query);

  const where: Prisma.SalesDocWhereInput = { shopId };
  if (kind) where.kind = kind;
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { docNo: { contains: q, mode: "insensitive" } },
      { customerNameSnap: { contains: q, mode: "insensitive" } },
    ];
  }

  const afterId = decodeCursor(cursor);
  const rows = await prisma.salesDoc.findMany({
    where,
    include: salesDocInclude,
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  const unitCodes = await unitCodesFor(page.flatMap((d) => d.lines.map((l) => l.saleUnitId)));
  const now = new Date();

  return {
    data: page.map((d) => toSalesDocDTO(d, unitCodes, now)),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
    },
  };
}

export async function getSalesDoc(shopId: string, id: Id): Promise<SalesDocDTO | null> {
  const doc = await prisma.salesDoc.findFirst({ where: { id, shopId }, include: salesDocInclude });
  if (!doc) return null;
  return toSalesDocDTO(doc, await unitCodesFor(doc.lines.map((l) => l.saleUnitId)), new Date());
}

/** Counts for the list-screen tabs, in one grouped query. */
export async function salesDocCounts(
  shopId: string,
  kind: SalesDocKind,
): Promise<{ open: number; converted: number; cancelled: number }> {
  const rows = await prisma.salesDoc.groupBy({
    by: ["status"],
    where: { shopId, kind },
    _count: { _all: true },
  });
  const get = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { open: get("OPEN"), converted: get("CONVERTED"), cancelled: get("CANCELLED") };
}

export {
  createSalesDocSchema,
  updateSalesDocSchema,
  cancelSalesDocSchema,
  listSalesDocsQuerySchema,
  salesDocKindSchema,
  SALES_DOC_KINDS,
} from "./schema";
export type {
  CreateSalesDocInput,
  UpdateSalesDocInput,
  CancelSalesDocInput,
  ListSalesDocsQuery,
  SalesDocKind,
  SalesDocLineInput,
  SalesDocPartyInput,
} from "./schema";
