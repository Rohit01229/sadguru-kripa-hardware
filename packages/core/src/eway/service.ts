// e-Way bill service (doc 20 §7).
//
// SCOPE, stated plainly: this does NOT call the government API. Generating an e-way
// bill programmatically needs GSP credentials plus production IP whitelisting (doc 20
// §3), which is a separate commercial and infrastructure decision. What this does is
// everything either side of that call — decide whether a bill is needed, capture the
// data the portal asks for, produce the portal's own upload JSON, and record the number
// and validity once issued. That is genuinely useful today and is the part that has to
// exist regardless of whether we ever automate the call itself.
import { prisma, runTx, type Prisma } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise } from "../shared/money";
import { toUqc } from "../shared/uqc";
import type { Id } from "../shared/types";
import {
  ewayBillRequired,
  validUntil as computeValidUntil,
  validityDays,
  documentTooOld,
  withinCancelWindow,
  TRANSPORT_MODE_CODE,
  EWB_DOC_TYPE,
  EWB_SUPPLY_TYPE_OUTWARD,
  EWB_SUB_SUPPLY_SUPPLY,
  type ThresholdDecision,
} from "./rules";
import {
  ewayBillDraftSchema,
  recordEwayBillSchema,
  cancelEwayBillSchema,
  type EwayBillDraftInput,
  type RecordEwayBillInput,
  type CancelEwayBillInput,
} from "./schema";

export interface EwayCtx {
  session: Session;
  requestId?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

export interface EwayBillDTO {
  id: Id;
  invoiceId: Id;
  status: "DRAFT" | "GENERATED" | "CANCELLED";
  consignmentValue: number; // paise
  fromPincode: string;
  toPincode: string;
  fromStateCode: string;
  toStateCode: string;
  distanceKm: number | null;
  transportMode: "ROAD" | "RAIL" | "AIR" | "SHIP" | null;
  vehicleNumber: string | null;
  overDimensional: boolean;
  transporterGstin: string | null;
  transporterName: string | null;
  transportDocNo: string | null;
  transportDocDate: string | null;
  ewbNo: string | null;
  ewbDate: string | null;
  validUntil: string | null;
  cancelledReason: string | null;
  /** True once Part-B is complete enough for the portal to start the clock. */
  partBComplete: boolean;
  createdAt: string;
}

type EwayRow = Prisma.EwayBillGetPayload<Record<string, never>>;

function toDTO(r: EwayRow): EwayBillDTO {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    status: r.status,
    consignmentValue: r.consignmentValue,
    fromPincode: r.fromPincode,
    toPincode: r.toPincode,
    fromStateCode: r.fromStateCode,
    toStateCode: r.toStateCode,
    distanceKm: r.distanceKm,
    transportMode: r.transportMode,
    vehicleNumber: r.vehicleNumber,
    overDimensional: r.overDimensional,
    transporterGstin: r.transporterGstin,
    transporterName: r.transporterName,
    transportDocNo: r.transportDocNo,
    transportDocDate: r.transportDocDate?.toISOString() ?? null,
    ewbNo: r.ewbNo,
    ewbDate: r.ewbDate?.toISOString() ?? null,
    validUntil: r.validUntil?.toISOString() ?? null,
    cancelledReason: r.cancelledReason,
    // Road transport identifies the vehicle; other modes identify the transport document.
    partBComplete:
      r.transportMode === "ROAD" ? Boolean(r.vehicleNumber) : Boolean(r.transportMode && r.transportDocNo),
    createdAt: r.createdAt.toISOString(),
  };
}

export interface EwayAssessment {
  /** Threshold verdict for this invoice. */
  decision: ThresholdDecision;
  /** The consignment value tested (paise) — the invoice grand total. */
  consignmentValue: number;
  /** True when the invoice is past the 180-day window and the portal will refuse it. */
  documentTooOld: boolean;
  /** Existing bill, if one has been started. */
  existing: EwayBillDTO | null;
  /** Blockers that would make the portal reject this — surfaced before any typing. */
  problems: string[];
}

/**
 * Should this invoice have an e-way bill, and can one still be raised?
 *
 * Read-only and cheap, so a page can call it to decide whether to show the section at
 * all. `thresholdOverridePaise` lets a shop apply their own state's figure.
 */
export async function assessEwayBill(
  shopId: string,
  invoiceId: Id,
  opts: { thresholdOverridePaise?: number | null; now?: Date } = {},
): Promise<EwayAssessment> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, shopId },
    select: {
      id: true,
      date: true,
      status: true,
      grandTotal: true,
      placeOfSupplyState: true,
      customerId: true,
    },
  });
  if (!invoice) throw new DomainError(`Invoice ${invoiceId} not found`, "NOT_FOUND");

  const [config, existing] = await Promise.all([
    prisma.storeConfig.findUnique({ where: { shopId }, select: { homeState: true, gstin: true } }),
    prisma.ewayBill.findUnique({ where: { invoiceId } }),
  ]);

  const consignmentValue = toPaise(invoice.grandTotal);
  const fromStateCode = (config?.homeState ?? "").padStart(2, "0");
  const toStateCode = invoice.placeOfSupplyState.padStart(2, "0");

  const decision = ewayBillRequired({
    consignmentValuePaise: consignmentValue,
    fromStateCode,
    toStateCode,
    overridePaise: opts.thresholdOverridePaise ?? null,
  });

  const problems: string[] = [];
  if (invoice.status === "CANCELLED") problems.push("This invoice is cancelled.");
  if (!config?.gstin) problems.push("Your shop GSTIN is not set in Settings.");
  if (!fromStateCode.trim()) problems.push("Your shop's home state is not set in Settings.");

  return {
    decision,
    consignmentValue,
    documentTooOld: documentTooOld(invoice.date, opts.now),
    existing: existing ? toDTO(existing) : null,
    problems,
  };
}

/** Read the e-way bill attached to an invoice, if any. */
export async function getEwayBill(shopId: string, invoiceId: Id): Promise<EwayBillDTO | null> {
  const row = await prisma.ewayBill.findFirst({ where: { invoiceId, shopId } });
  return row ? toDTO(row) : null;
}

/**
 * Create or update the e-way bill draft for an invoice. Idempotent by invoice — there
 * is one live bill per invoice, so repeated saves edit the same row.
 *
 * Guarded by `bill.pakka.create`: an e-way bill accompanies a tax invoice, so whoever
 * may raise the invoice may raise its transport document. A GENERATED bill is locked —
 * the portal is authoritative once a number exists, and silently editing our copy would
 * put it out of step with the government's record.
 */
export async function saveEwayBillDraft(
  invoiceId: Id,
  input: EwayBillDraftInput,
  ctx: EwayCtx,
): Promise<EwayBillDTO> {
  requirePermission(ctx.session, "bill.pakka.create");
  const shopId = requireShop(ctx.session);
  const data = ewayBillDraftSchema.parse(input);

  const assessment = await assessEwayBill(shopId, invoiceId);
  if (assessment.existing?.status === "GENERATED") {
    throw new DomainError(
      "This e-way bill already has a number. Cancel it on the portal before changing the details.",
      "VALIDATION",
    );
  }
  if (assessment.documentTooOld) {
    throw new DomainError(
      "This invoice is more than 180 days old — the portal will not accept an e-way bill for it.",
      "VALIDATION",
    );
  }

  const row = await runTx(async (tx) => {
    const payload = {
      shopId,
      consignmentValue: assessment.consignmentValue,
      fromPincode: data.fromPincode,
      toPincode: data.toPincode,
      fromStateCode: data.fromStateCode,
      toStateCode: data.toStateCode,
      distanceKm: data.distanceKm ?? null,
      transportMode: data.transportMode ?? null,
      vehicleNumber: data.vehicleNumber || null,
      overDimensional: data.overDimensional ?? false,
      transporterGstin: data.transporterGstin || null,
      transporterName: data.transporterName || null,
      transportDocNo: data.transportDocNo || null,
      transportDocDate: data.transportDocDate ?? null,
    };

    const saved = await tx.ewayBill.upsert({
      where: { invoiceId },
      create: { invoiceId, createdById: ctx.session.userId, ...payload },
      update: payload,
    });

    await audit(tx, {
      ...auditMeta(ctx.session),
      shopId,
      permissionUsed: "bill.pakka.create",
      action: "eway.draft.save",
      targetType: "EwayBill",
      targetId: saved.id,
      after: { invoiceId, distanceKm: payload.distanceKm, mode: payload.transportMode },
      requestId: ctx.requestId,
    });
    return saved;
  });

  return toDTO(row);
}

/**
 * Record the number the portal issued. Validity is computed HERE from the distance and
 * cargo type, because the clock starts when the vehicle details exist (Rule 138(10)) —
 * not when the consignment was first entered.
 */
export async function recordEwayBillNumber(
  invoiceId: Id,
  input: RecordEwayBillInput,
  ctx: EwayCtx,
): Promise<EwayBillDTO> {
  requirePermission(ctx.session, "bill.pakka.create");
  const shopId = requireShop(ctx.session);
  const data = recordEwayBillSchema.parse(input);

  const row = await runTx(async (tx) => {
    const existing = await tx.ewayBill.findFirst({ where: { invoiceId, shopId } });
    if (!existing) throw new DomainError("Fill in the transport details first.", "NOT_FOUND");
    if (existing.status === "CANCELLED") {
      throw new DomainError("This e-way bill is cancelled.", "VALIDATION");
    }

    const issuedAt = data.ewbDate ?? new Date();
    const saved = await tx.ewayBill.update({
      where: { id: existing.id },
      data: {
        status: "GENERATED",
        ewbNo: data.ewbNo,
        ewbDate: issuedAt,
        validUntil: computeValidUntil(issuedAt, existing.distanceKm ?? 0, existing.overDimensional),
      },
    });

    await audit(tx, {
      ...auditMeta(ctx.session),
      shopId,
      permissionUsed: "bill.pakka.create",
      action: "eway.recorded",
      targetType: "EwayBill",
      targetId: saved.id,
      after: { ewbNo: saved.ewbNo, validUntil: saved.validUntil?.toISOString() ?? null },
      requestId: ctx.requestId,
    });
    return saved;
  });

  return toDTO(row);
}

/**
 * Mark an e-way bill cancelled. The 24-hour window is enforced here so our record
 * cannot drift from what the portal will actually allow — but note the portal ALSO
 * refuses cancellation once a bill has been verified in transit, which we cannot see.
 * So a pass here is necessary, not sufficient: cancel on the portal first.
 */
export async function cancelEwayBill(
  invoiceId: Id,
  input: CancelEwayBillInput,
  ctx: EwayCtx,
): Promise<EwayBillDTO> {
  requirePermission(ctx.session, "bill.cancel");
  const shopId = requireShop(ctx.session);
  const data = cancelEwayBillSchema.parse(input);

  const row = await runTx(async (tx) => {
    const existing = await tx.ewayBill.findFirst({ where: { invoiceId, shopId } });
    if (!existing) throw new DomainError("No e-way bill on this invoice.", "NOT_FOUND");
    if (existing.status === "CANCELLED") {
      throw new DomainError("Already cancelled.", "ALREADY_CANCELLED");
    }
    if (existing.status === "GENERATED" && existing.ewbDate && !withinCancelWindow(existing.ewbDate)) {
      throw new DomainError(
        "An e-way bill can only be cancelled within 24 hours of generation.",
        "VALIDATION",
      );
    }

    const saved = await tx.ewayBill.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        cancelledReason: data.remark ? `${data.reason}: ${data.remark}` : data.reason,
      },
    });

    await audit(tx, {
      ...auditMeta(ctx.session),
      shopId,
      permissionUsed: "bill.cancel",
      action: "eway.cancelled",
      targetType: "EwayBill",
      targetId: saved.id,
      before: { ewbNo: existing.ewbNo },
      after: { reason: saved.cancelledReason },
      requestId: ctx.requestId,
    });
    return saved;
  });

  return toDTO(row);
}

// ─────────────────── Portal upload payload ───────────────────

/** The e-way bill portal wants DD/MM/YYYY, not ISO. */
function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Paise → the rupee number the portal expects. */
const rupees = (paise: number) => Math.round(paise) / 100;

/**
 * Build the JSON the e-way bill portal accepts for bulk upload.
 *
 * This is the pragmatic bridge while we have no API credentials: the shopkeeper
 * downloads this and uploads it to ewaybillgst.gov.in, instead of re-typing a
 * consignment by hand. The field names are the portal's, not ours — deliberately, so
 * the file is accepted verbatim.
 */
export async function buildEwayBillPayload(shopId: string, invoiceId: Id): Promise<Record<string, unknown>> {
  const [invoice, config, eway] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id: invoiceId, shopId },
      include: { lines: true, customer: { select: { name: true, gstin: true } } },
    }),
    prisma.storeConfig.findUnique({ where: { shopId } }),
    prisma.ewayBill.findFirst({ where: { invoiceId, shopId } }),
  ]);
  if (!invoice) throw new DomainError(`Invoice ${invoiceId} not found`, "NOT_FOUND");
  if (!eway) throw new DomainError("Fill in the transport details first.", "NOT_FOUND");

  // Resolve product + unit names for the item list (the DTO carries only ids).
  const productIds = [...new Set(invoice.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { shopId, id: { in: productIds } },
    select: {
      id: true,
      name: true,
      hsnCode: true,
      saleUnits: { select: { id: true, unit: { select: { code: true, name: true } } } },
    },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));

  const itemList = invoice.lines.map((l, i) => {
    const p = pmap.get(l.productId);
    const su = p?.saleUnits.find((s) => s.id === l.saleUnitId);
    const gstRate = Number(l.gstRate);
    const isIgst = toPaise(l.igst) > 0;
    return {
      itemNo: i + 1,
      productName: p?.name ?? "Item",
      productDesc: p?.name ?? "Item",
      hsnCode: Number(l.hsnCode ?? p?.hsnCode ?? 0),
      quantity: Number(l.saleQty),
      // Free text is rejected by the portal — map onto the official UQC list.
      qtyUnit: toUqc(su?.unit.code ?? "", su?.unit.name),
      taxableAmount: rupees(toPaise(l.taxableValue)),
      sgstRate: isIgst ? 0 : gstRate / 2,
      cgstRate: isIgst ? 0 : gstRate / 2,
      igstRate: isIgst ? gstRate : 0,
      cessRate: 0,
    };
  });

  const buyerGstin = invoice.customerGstinSnap ?? invoice.customer?.gstin ?? null;

  return {
    supplyType: EWB_SUPPLY_TYPE_OUTWARD,
    subSupplyType: EWB_SUB_SUPPLY_SUPPLY,
    docType: EWB_DOC_TYPE,
    docNo: invoice.invoiceNo,
    docDate: ddmmyyyy(invoice.date),

    fromGstin: config?.gstin ?? "",
    fromTrdName: config?.name ?? "",
    fromAddr1: config?.address ?? "",
    fromPlace: "",
    fromPincode: Number(eway.fromPincode),
    fromStateCode: Number(eway.fromStateCode),
    actFromStateCode: Number(eway.fromStateCode),

    // "URP" = unregistered person, the portal's marker for a buyer with no GSTIN.
    toGstin: buyerGstin ?? "URP",
    toTrdName: invoice.customerNameSnap ?? invoice.customer?.name ?? "Walk-in customer",
    toAddr1: "",
    toPlace: "",
    toPincode: Number(eway.toPincode),
    toStateCode: Number(eway.toStateCode),
    actToStateCode: Number(eway.toStateCode),

    totalValue: rupees(toPaise(invoice.taxableTotal)),
    cgstValue: rupees(toPaise(invoice.cgstTotal)),
    sgstValue: rupees(toPaise(invoice.sgstTotal)),
    igstValue: rupees(toPaise(invoice.igstTotal)),
    cessValue: 0,
    otherValue: rupees(toPaise(invoice.roundOff)),
    totInvValue: rupees(toPaise(invoice.grandTotal)),

    transporterId: eway.transporterGstin ?? "",
    transporterName: eway.transporterName ?? "",
    transDocNo: eway.transportDocNo ?? "",
    transDocDate: eway.transportDocDate ? ddmmyyyy(eway.transportDocDate) : "",
    transMode: eway.transportMode ? TRANSPORT_MODE_CODE[eway.transportMode] : "",
    transDistance: String(eway.distanceKm ?? 0),
    vehicleNo: eway.vehicleNumber ?? "",
    // R = regular, O = over-dimensional cargo.
    vehicleType: eway.overDimensional ? "O" : "R",

    itemList,
  };
}

/** Days this bill is valid for, given its distance and cargo type. */
export function ewayValidityDays(distanceKm: number | null, overDimensional: boolean): number {
  return validityDays(distanceKm ?? 0, overDimensional);
}

export * from "./rules";
export * from "./schema";
