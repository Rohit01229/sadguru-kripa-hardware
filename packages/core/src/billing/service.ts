// Billing kernel (03 §7): ONLY Billing mints invoice / credit-note numbers, and
// only inside the invoice transaction. S1 ships the gapless, concurrency-safe
// numbering primitive every finalize reuses; S4 (this slice) adds the counter
// billing vertical — finalizeKacha (zero-trace), finalizePakka (full GST invoice),
// convertKachaToPakka, and the invoice reads for reprint. Cancel / credit-note land
// in S5.
import Decimal from "decimal.js";
import { Prisma, prisma, runTx, type Tx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise, fromPaise } from "../shared/money";
import { toBaseQty } from "../shared/uom";
import { decrementStock, incrementStock } from "../inventory/service";
import { post as ledgerPost } from "../ledger/service";
import { findIdempotent, hashRequest, storeIdempotent } from "../shared/idempotency";
import {
  cancelInvoiceSchema,
  createCreditNoteSchema,
  type CancelInvoiceInput,
  type CreateCreditNoteInput,
} from "../ledger/schema";
import type { Id } from "../shared/types";
import { financialYear, formatInvoiceNo } from "./numbering";
import { computeInvoiceTotals, type LineInput } from "./totals";
import {
  kachaDecrementSchema,
  finalizePakkaSchema,
  convertKachaSchema,
  listInvoicesQuerySchema,
  type KachaDecrementInput,
  type FinalizePakkaInput,
  type ConvertKachaInput,
  type ListInvoicesQuery,
} from "./schema";

interface CounterRow {
  lastNo: number;
}

/**
 * Allocate the next gapless invoice number for a financial year (03 §7),
 * INSIDE the caller's invoice transaction.
 *
 *   UPDATE "InvoiceCounter" SET "lastNo" = "lastNo" + 1 WHERE fy = $fy RETURNING "lastNo"
 *
 * Why this is gapless and race-safe:
 *  - The UPDATE … RETURNING takes a ROW LOCK on that FY's counter; a concurrent
 *    finalize blocks until this transaction COMMITs or ROLLBACKs.
 *  - The number is allocated in the SAME transaction as the Invoice insert, so a
 *    rolled-back bill burns no number (the increment rolls back too) — no gaps.
 *  - The counter row is upserted on first use so a brand-new FY starts at 1.
 *  - @@unique(fy, invoiceNo) on Invoice is the backstop against any bug.
 *
 * Returns both the raw sequence and the formatted "<FY>/<6-digit>" string.
 */
export async function nextInvoiceNo(
  tx: Tx,
  fy: string,
): Promise<{ seq: number; invoiceNo: string }> {
  // Ensure the FY counter row exists without disturbing an existing one.
  await tx.invoiceCounter.upsert({ where: { fy }, create: { fy, lastNo: 0 }, update: {} });

  const rows = await tx.$queryRaw<CounterRow[]>`
    UPDATE "InvoiceCounter"
    SET "lastNo" = "lastNo" + 1
    WHERE "fy" = ${fy}
    RETURNING "lastNo"`;

  const seq = rows[0]!.lastNo;
  return { seq, invoiceNo: formatInvoiceNo(fy, seq) };
}

/**
 * Allocate the next gapless CREDIT-NOTE number — an INDEPENDENT series from
 * invoices (03 §7, 13 §8) — using the identical row-lock pattern against
 * CreditNoteCounter. Reused by S5 createCreditNote inside its transaction.
 */
export async function nextCreditNoteNo(
  tx: Tx,
  fy: string,
): Promise<{ seq: number; creditNoteNo: string }> {
  await tx.creditNoteCounter.upsert({ where: { fy }, create: { fy, lastNo: 0 }, update: {} });

  const rows = await tx.$queryRaw<CounterRow[]>`
    UPDATE "CreditNoteCounter"
    SET "lastNo" = "lastNo" + 1
    WHERE "fy" = ${fy}
    RETURNING "lastNo"`;

  const seq = rows[0]!.lastNo;
  return { seq, creditNoteNo: formatInvoiceNo(fy, seq) };
}

// ════════════════════════════════════════════════════════════════════════════
//  S4 — Counter billing (kacha zero-trace + pakka GST invoice)
//  Each user action = ONE core service call = ONE prisma.$transaction (03 §2),
//  permission-guarded + audited in the SAME tx (10 §7). Only Inventory mutates
//  stock (decrementStock); only Billing mints numbers + tax rows (03 §3).
// ════════════════════════════════════════════════════════════════════════════

export interface BillingCtx {
  session: Session;
  requestId?: string | null;
  /** Idempotency-Key header (pakka/convert are bill-creating → idempotent — 04 §5). */
  idempotencyKey?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

/** A 3dp Prisma Decimal (quantities are @db.Decimal(14,3)). */
function qty3(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(3));
}
/** A 2dp Prisma Decimal (money is @db.Decimal(14,2)). */
function money2(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(2));
}

interface LoadedSaleUnit {
  saleUnitId: string;
  unitCode: string;
  unitKind: "MEASURED" | "PIECE";
  factorToBase: Prisma.Decimal;
  /** Catalog/pricing default per-sale-unit price (rupees). */
  defaultPrice: Prisma.Decimal;
  productId: string;
  gstRate: Prisma.Decimal;
  priceInclusive: boolean;
  hsnCode: string | null;
}

/**
 * Load a (product, saleUnit) pair with everything billing needs: the conversion
 * factor + unit kind (UoM), the catalog default price, and the product's GST rate /
 * inclusive flag / HSN. Throws NOT_FOUND when the sale unit does not belong to the
 * product (guards against cross-product spoofing). Uses the caller's tx so the read
 * is consistent with the decrement in the same transaction.
 */
async function loadLineCatalog(tx: Tx, productId: string, saleUnitId: string): Promise<LoadedSaleUnit> {
  const su = await tx.productSaleUnit.findFirst({
    where: { id: saleUnitId, productId },
    select: {
      id: true,
      factorToBase: true,
      salePrice: true,
      unit: { select: { code: true, kind: true } },
      product: { select: { id: true, gstRate: true, priceInclusive: true, hsnCode: true } },
    },
  });
  if (!su) throw new DomainError(`Sale unit ${saleUnitId} not found for product ${productId}`, "NOT_FOUND");
  return {
    saleUnitId: su.id,
    unitCode: su.unit.code,
    unitKind: su.unit.kind,
    factorToBase: su.factorToBase,
    defaultPrice: su.salePrice,
    productId: su.product.id,
    gstRate: su.product.gstRate,
    priceInclusive: su.product.priceInclusive,
    hsnCode: su.product.hsnCode,
  };
}

/** Sale-unit qty → base-unit Prisma Decimal (rejects fractional PIECE via toBaseQty — 03 §4). */
function toBase(quantity: string, su: LoadedSaleUnit): Prisma.Decimal {
  const base = toBaseQty(quantity, {
    code: su.unitCode,
    kind: su.unitKind,
    factorToBase: su.factorToBase.toString(),
  });
  return qty3(base);
}

// ─────────────────── Kacha (zero-trace) ───────────────────
export interface KachaEstimateLine {
  productId: Id;
  saleUnitId: Id;
  quantity: string;
  baseQuantity: string;
  /** The single KACHA_OUT movement this line produced (so a later convert can attribute it). */
  stockMovementId: Id;
}
export interface KachaEstimate {
  /** Ephemeral, NON-persisted estimate — there is NO invoice number, NO bill row (03 §6). */
  type: "KACHA_ESTIMATE";
  lines: KachaEstimateLine[];
  /** Movement ids, in line order — passed back on convert as stockMovementRefs (04 §8.4). */
  stockMovementRefs: Id[];
  createdAt: string;
}

/**
 * Kacha finalize — the deliberate zero-trace exception (03 §6, 13 §8). ONE
 * transaction that writes EXACTLY ONE StockMovement{kind: KACHA_OUT} per line via the
 * inventory kernel and NOTHING else: no Invoice, no InvoiceLine, no Payment, no
 * value, no customer, no tax, no ledger row. Returns an ephemeral estimate payload
 * for printing (no invoice number, no persisted bill). The decrement is wrapped in
 * the atomic stock guard so an oversell still throws InsufficientStock and rolls the
 * whole thing back. Audited as an UNATTRIBUTED stock-out (actor + movement only,
 * 10 §7) — by design the audit row carries no bill/customer/value.
 *
 * NOT idempotent in the bill sense (04 §5): no bill is persisted, so there is nothing
 * to dedupe against; the client guards double-submit in the UI.
 */
export async function finalizeKacha(input: KachaDecrementInput, ctx: BillingCtx): Promise<KachaEstimate> {
  requirePermission(ctx.session, "bill.kacha.create");
  const data = kachaDecrementSchema.parse(input);

  return await runTx(async (tx) => {
    const lines: KachaEstimateLine[] = [];
    const refs: string[] = [];

    for (const line of data.lines) {
      const su = await loadLineCatalog(tx, line.productId, line.saleUnitId);
      const baseQty = toBase(line.quantity, su);
      // Inventory kernel: atomic −stock + ONE signed KACHA_OUT movement. No refType/
      // refId/customer — an UNATTRIBUTED stock-out, but tagged KACHA_OUT so Reports
      // can separate kacha sale from real shrinkage (03 §6). actorStaffId on the
      // movement is the only attribution kept.
      const movementId = await decrementStock(tx, line.productId, baseQty, "KACHA_OUT", {
        actorStaffId: ctx.session.userId,
      });
      lines.push({
        productId: line.productId,
        saleUnitId: line.saleUnitId,
        quantity: line.quantity,
        baseQuantity: baseQty.toString(),
        stockMovementId: movementId,
      });
      refs.push(movementId);
    }

    // Audited as an unattributed stock-out: actor + movement only, NO bill/value (10 §7).
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "bill.kacha.create",
      action: "bill.kacha.create",
      targetType: "StockMovement",
      targetId: refs[0] ?? null,
      after: { kind: "KACHA_OUT", lines: data.lines.length, movementIds: refs },
      requestId: ctx.requestId,
    });

    return {
      type: "KACHA_ESTIMATE",
      lines,
      stockMovementRefs: refs,
      createdAt: new Date().toISOString(),
    };
  });
}

// ─────────────────── Pakka (full GST tax invoice) ───────────────────
export interface InvoiceLineDTO {
  productId: Id;
  saleUnitId: Id;
  hsnCode: string | null;
  saleQty: string;
  baseQty: string;
  unitPrice: number; // paise (effective; may be a manual override)
  lineDiscount: number; // paise
  taxableValue: number; // paise (after discount, before tax)
  gstRatePct: string;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number; // paise
}
export interface PaymentDTO {
  mode: "CASH" | "UPI" | "CARD" | "CREDIT";
  amount: number; // paise
  reference: string | null;
}
export interface InvoiceDTO {
  id: Id;
  fy: string;
  invoiceNo: string;
  invoiceType: "PAKKA";
  taxKind: "CGST_SGST" | "IGST";
  placeOfSupplyState: string;
  customerId: Id | null;
  customerName: string | null;
  customerGstin: string | null;
  date: string;
  lines: InvoiceLineDTO[];
  taxableTotal: number;
  discountTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  roundOff: number; // paise (signed)
  grandTotal: number; // paise
  payments: PaymentDTO[];
  amountPaid: number; // paise
  balanceToLedger: number; // paise (khata — posted to ledger in S5)
  changeDue: number; // paise (cash overpayment)
  status: "ACTIVE" | "CANCELLED";
  convertedFromKacha?: boolean;
  createdAt: string;
}

/** PaymentMode on the wire/schema is KHATA; the DB enum stores it as CREDIT. */
function toDbPaymentMode(mode: "CASH" | "UPI" | "CARD" | "KHATA"): "CASH" | "UPI" | "CARD" | "CREDIT" {
  return mode === "KHATA" ? "CREDIT" : mode;
}

interface FinalizePakkaOptions {
  /** Convert path: the kacha already decremented stock — attribute, don't re-deduct (04 §8.4). */
  stockAlreadyDecremented?: boolean;
  stockMovementRefs?: string[];
  convertedFromKacha?: boolean;
  /** The logical route for idempotency storage (differs for /pakka vs /convert). */
  route: string;
  /** The raw validated request body, for the idempotency request hash. */
  requestBody: unknown;
}

/**
 * The shared pakka-create transaction used by both finalizePakka and
 * convertKachaToPakka. ONE prisma.$transaction (03 §2):
 *  1. nextInvoiceNo(fy) — gapless number allocated under a row lock IN THIS TX, so a
 *     rolled-back bill burns no number (03 §7).
 *  2. per line: resolve the effective price (manual override > catalog default),
 *     convert qty → base, compute discount-before-tax + place-of-supply tax via the
 *     pure computeInvoiceTotals (03 §8), and decrement stock SALE_OUT — UNLESS the
 *     kacha already decremented, in which case the existing KACHA_OUT movement is
 *     attributed to this invoice instead of double-deducting.
 *  3. insert Invoice + InvoiceLine[] + Payment(s); per-invoice round-off.
 *  4. audit() in the same tx (10 §7); store the idempotency response in the same tx.
 * Idempotent on the Idempotency-Key (04 §5): a retry replays the original invoice,
 * never burning a second number.
 */
async function finalizePakkaTx(
  data: FinalizePakkaInput,
  ctx: BillingCtx,
  opts: FinalizePakkaOptions,
): Promise<InvoiceDTO> {
  requirePermission(ctx.session, "bill.pakka.create");

  // KHATA / part-payment posts the unpaid balance to the customer ledger (S5 — wired
  // below via ledger.post inside the SAME invoice tx). A khata sale MUST name an
  // existing Customer party so the receivable is attributable; reject otherwise
  // rather than silently dropping a receivable.
  if (data.payment.mode === "KHATA" && !data.customer?.customerId) {
    throw new DomainError(
      "Khata / credit billing requires an existing customer to post the receivable against.",
      "KHATA_CUSTOMER_REQUIRED",
    );
  }

  const requestHash = hashRequest(opts.requestBody);
  if (ctx.idempotencyKey) {
    const { replay } = await findIdempotent<InvoiceDTO>(
      ctx.idempotencyKey,
      ctx.session.userId,
      opts.route,
      requestHash,
    );
    if (replay) return replay.response;
  }

  const now = new Date();
  const fy = financialYear(now);

  // Resolve home state (place-of-supply default) from StoreConfig outside the tx —
  // it is a stable single-row config read.
  const store = await prisma.storeConfig.findUnique({
    where: { id: "default" },
    select: { homeState: true, gstRoundingMode: true },
  });
  if (!store) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");
  const homeState = store.homeState;
  const supplyState = data.placeOfSupplyState?.trim() || homeState;

  try {
    return await runTx(async (tx) => {
      // 1. Gapless number IN THIS TX (rollback burns none — 03 §7).
      const { invoiceNo } = await nextInvoiceNo(tx, fy);

      // 2. Load catalog + convert + decrement per line, collecting LineInput for the
      // pure tax computation. Order is preserved so stockMovementRefs[i] maps to line i.
      const loaded: { line: FinalizePakkaInput["lines"][number]; cat: LoadedSaleUnit; baseQty: Prisma.Decimal; unitPrice: Prisma.Decimal }[] = [];
      const taxInputs: LineInput[] = [];

      for (let i = 0; i < data.lines.length; i++) {
        const line = data.lines[i]!;
        const cat = await loadLineCatalog(tx, line.productId, line.saleUnitId);
        const baseQty = toBase(line.quantity, cat);
        // Manual rate override (10 §4) wins over the catalog default; both are
        // per-sale-unit prices (inclusive iff product.priceInclusive — 03 §8).
        const unitPrice =
          line.rateOverride != null ? fromPaise(line.rateOverride) : cat.defaultPrice;

        // Stock: SALE_OUT, UNLESS the kacha already decremented (attribute, no re-deduct).
        if (!opts.stockAlreadyDecremented) {
          await decrementStock(tx, line.productId, baseQty, "SALE_OUT", {
            refType: "INVOICE",
            refId: invoiceNo,
            actorStaffId: ctx.session.userId,
          });
        } else {
          // Attribute the existing KACHA_OUT movement to this invoice (04 §8.4) so the
          // movement ledger ties the stock-out to the real bill without double-deducting.
          const movementId = opts.stockMovementRefs?.[i];
          if (movementId) {
            await tx.stockMovement.updateMany({
              where: { id: movementId, refId: null },
              data: { refType: "INVOICE", refId: invoiceNo },
            });
          }
        }

        loaded.push({ line, cat, baseQty, unitPrice });
        taxInputs.push({
          unitPrice: unitPrice,
          qty: new Decimal(line.quantity),
          gstRatePct: cat.gstRate,
          lineDiscount: fromPaise(line.lineDiscount ?? 0),
          priceInclusive: cat.priceInclusive,
        });
      }

      // 3. Pure totals: discount-before-tax, MRP back-calc, place-of-supply split,
      // per-invoice round-off (03 §8). roundOff disabled if the store config says so.
      const doRound = data.roundOff && store.gstRoundingMode !== "NONE";
      const totals = computeInvoiceTotals({
        lines: taxInputs,
        supplyState,
        homeState,
        billDiscount: fromPaise(data.billDiscount ?? 0),
        roundOff: doRound,
      });

      // 4. Persist Invoice + lines + payment(s).
      const customer = data.customer ?? null;
      const invoice = await tx.invoice.create({
        data: {
          fy,
          invoiceNo,
          customerId: customer?.customerId ?? null,
          customerNameSnap: customer?.name ?? null,
          customerGstinSnap: customer?.gstin ?? null,
          placeOfSupplyState: supplyState,
          date: now,
          taxableTotal: money2(totals.taxableTotal),
          discountTotal: money2(totals.discountTotal),
          cgstTotal: money2(totals.cgstTotal),
          sgstTotal: money2(totals.sgstTotal),
          igstTotal: money2(totals.igstTotal),
          roundOff: money2(totals.roundOff),
          grandTotal: money2(totals.grandTotal),
          status: "ACTIVE",
          createdById: ctx.session.userId,
          lines: {
            create: loaded.map((l, i) => {
              const c = totals.lines[i]!;
              return {
                productId: l.line.productId,
                saleUnitId: l.line.saleUnitId,
                hsnCode: l.cat.hsnCode,
                saleQty: qty3(l.line.quantity),
                baseQty: l.baseQty,
                unitPrice: money2(l.unitPrice),
                lineDiscount: money2(c.discount),
                taxableValue: money2(c.taxableValue),
                gstRate: new Prisma.Decimal(l.cat.gstRate),
                cgst: money2(c.cgst),
                sgst: money2(c.sgst),
                igst: money2(c.igst),
              };
            }),
          },
        },
        select: { id: true, date: true, createdAt: true },
      });

      // Payment. CASH/UPI/CARD: the tendered amount over the grand total is change-due.
      // KHATA: the amountPaid is a part-payment (0 for pure khata); the unpaid balance
      // is posted to the customer's ledger as an INVOICE_DEBIT in THIS SAME tx (S5).
      const grandPaise = toPaise(totals.grandTotal);
      const tendered = data.payment.amountPaid ?? 0;
      const isKhata = data.payment.mode === "KHATA";
      const dbMode = toDbPaymentMode(data.payment.mode);
      // The recorded payment never exceeds the grand total; the rest is change (cash).
      // On khata there is no change — any overpayment simply settles the balance.
      const recorded = Math.min(tendered, grandPaise);
      const changeDue = isKhata ? 0 : Math.max(tendered - grandPaise, 0);

      const payments: PaymentDTO[] = [];
      if (recorded > 0) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            customerId: customer?.customerId ?? null,
            mode: dbMode,
            amount: fromPaise(recorded),
            reference: data.payment.reference ?? null,
          },
        });
        payments.push({ mode: dbMode, amount: recorded, reference: data.payment.reference ?? null });
      }
      const balanceToLedger = Math.max(grandPaise - recorded, 0);

      // Khata: post the unpaid balance as a receivable on the customer ledger (13 §7,
      // S5). Only a khata sale with an outstanding balance posts — a fully-paid khata
      // sale (rare) posts nothing. customerId is guaranteed present for khata (checked
      // above). Cash/UPI/card sales NEVER touch the ledger.
      if (isKhata && balanceToLedger > 0) {
        await ledgerPost(tx, customer!.customerId!, "INVOICE_DEBIT", fromPaise(balanceToLedger), {
          refType: "INVOICE",
          refId: invoice.id,
          note: invoiceNo,
        });
      }

      const dto: InvoiceDTO = {
        id: invoice.id,
        fy,
        invoiceNo,
        invoiceType: "PAKKA",
        taxKind: totals.taxKind,
        placeOfSupplyState: supplyState,
        customerId: customer?.customerId ?? null,
        customerName: customer?.name ?? null,
        customerGstin: customer?.gstin ?? null,
        date: invoice.date.toISOString(),
        lines: loaded.map((l, i) => {
          const c = totals.lines[i]!;
          return {
            productId: l.line.productId,
            saleUnitId: l.line.saleUnitId,
            hsnCode: l.cat.hsnCode,
            saleQty: new Decimal(l.line.quantity).toFixed(3),
            baseQty: l.baseQty.toString(),
            unitPrice: toPaise(l.unitPrice),
            lineDiscount: toPaise(c.discount),
            taxableValue: toPaise(c.taxableValue),
            gstRatePct: l.cat.gstRate.toString(),
            cgst: toPaise(c.cgst),
            sgst: toPaise(c.sgst),
            igst: toPaise(c.igst),
            lineTotal: toPaise(c.lineTotal),
          };
        }),
        taxableTotal: toPaise(totals.taxableTotal),
        discountTotal: toPaise(totals.discountTotal),
        cgstTotal: toPaise(totals.cgstTotal),
        sgstTotal: toPaise(totals.sgstTotal),
        igstTotal: toPaise(totals.igstTotal),
        roundOff: toPaise(totals.roundOff),
        grandTotal: grandPaise,
        payments,
        amountPaid: recorded,
        balanceToLedger,
        changeDue,
        status: "ACTIVE",
        ...(opts.convertedFromKacha ? { convertedFromKacha: true } : {}),
        createdAt: invoice.createdAt.toISOString(),
      };

      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "bill.pakka.create",
        action: "bill.pakka.create",
        targetType: "Invoice",
        targetId: invoice.id,
        after: {
          invoiceNo,
          grandTotal: grandPaise,
          taxKind: totals.taxKind,
          paymentMode: dbMode,
          balanceToLedger,
          convertedFromKacha: opts.convertedFromKacha ?? false,
        },
        requestId: ctx.requestId,
      });

      if (ctx.idempotencyKey) {
        await storeIdempotent(tx, ctx.idempotencyKey, ctx.session.userId, opts.route, requestHash, dto, 201);
      }
      return dto;
    });
  } catch (e) {
    // Two concurrent first attempts can race on the unique (key, principal, route):
    // the loser's tx rolls back on P2002. Re-read the winner's stored response and
    // replay it, so a double-submit yields one invoice and the original payload.
    if (
      ctx.idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      (e.meta?.target as string[] | string | undefined)?.toString().includes("key")
    ) {
      const { replay } = await findIdempotent<InvoiceDTO>(
        ctx.idempotencyKey,
        ctx.session.userId,
        opts.route,
        requestHash,
      );
      if (replay) return replay.response;
    }
    throw e;
  }
}

/**
 * Create a pakka (full GST) tax invoice (04 §8.3). Decrements stock SALE_OUT per
 * line, allocates a gapless number, computes place-of-supply tax + round-off,
 * persists Invoice + lines + payment(s). Idempotent on the Idempotency-Key.
 */
export async function finalizePakka(input: FinalizePakkaInput, ctx: BillingCtx): Promise<InvoiceDTO> {
  const data = finalizePakkaSchema.parse(input);
  return finalizePakkaTx(data, ctx, {
    route: "POST /api/billing/pakka",
    requestBody: data,
  });
}

/**
 * Convert the in-memory kacha cart → a real pakka invoice (03 §6, 04 §8.4). This is
 * NEVER an upgrade of a committed kacha: "convert" simply submits the same cart to
 * the pakka-create path. If a prior /kacha/decrement already removed the stock
 * (`stockAlreadyDecremented`), the existing KACHA_OUT movements are ATTRIBUTED to the
 * new invoice instead of double-deducting; otherwise stock is decremented now.
 * Idempotent on the Idempotency-Key.
 */
export async function convertKachaToPakka(input: ConvertKachaInput, ctx: BillingCtx): Promise<InvoiceDTO> {
  const data = convertKachaSchema.parse(input);
  return finalizePakkaTx(data, ctx, {
    stockAlreadyDecremented: data.stockAlreadyDecremented,
    stockMovementRefs: data.stockMovementRefs,
    convertedFromKacha: true,
    route: "POST /api/billing/kacha/convert",
    requestBody: data,
  });
}

// ─────────────────── Pakka-on-dispatch (Orders delegates here — 03 §3) ───────────────────
export interface OrderInvoiceLineInput {
  productId: string;
  saleUnitId: string;
  /** Sale quantity (decimal string) the order line carried. */
  quantity: string;
  /** Base-unit qty the order reserved/dispatched (already UoM-converted by Orders). */
  baseQty: Prisma.Decimal;
  /** Effective per-sale-unit price in RUPEES the order locked at placement. */
  unitPrice: Prisma.Decimal;
}

export interface OrderInvoiceInput {
  orderId: string;
  /** Customer billing party (the storefront account's Customer — 13 §7). */
  customerId: string;
  customerName: string | null;
  customerGstin: string | null;
  /** Place of supply for the order (delivery address state, or home state for pickup). */
  supplyState: string;
  lines: OrderInvoiceLineInput[];
  /** True when the order was paid online (record a CARD/gateway Payment row). */
  paidOnline: boolean;
  /** Razorpay payment id, recorded as the Payment reference when paidOnline. */
  paymentReference?: string | null;
  roundOff?: boolean;
}

/**
 * Mint the pakka tax invoice for an order at DISPATCH, INSIDE the caller's (orders)
 * transaction — pakka-on-dispatch (03 §3, 14 Chunk 10). Orders has already converted
 * the reservation into the final ORDER_DISPATCH_OUT stock decrement, so this mints
 * the bill ONLY (numbering + place-of-supply tax + Invoice rows) and NEVER touches
 * stock. Keeping this in Billing preserves the invariant "only Billing mints invoice
 * numbers + tax rows" (03 §3): Orders delegates rather than duplicating.
 *
 *  - `nextInvoiceNo(tx, fy)` — gapless number under a row lock in THIS tx (03 §7);
 *    a rolled-back dispatch burns no number.
 *  - place-of-supply tax via the pure computeInvoiceTotals (IGST if inter-state).
 *  - `Invoice.orderId` ties the bill 1:1 to the order (@@unique backstop — 13 §9).
 *  - a paid-online order records a CARD Payment (gateway) referencing the Razorpay
 *    payment id; pay-later orders record none (settled at the counter/on delivery).
 *
 * The order's place-of-supply already decides intra/inter-state, so the caller need
 * not pass homeState; we read it from StoreConfig.
 */
export async function buildOrderInvoiceTx(tx: Tx, input: OrderInvoiceInput): Promise<InvoiceDTO> {
  const now = new Date();
  const fy = financialYear(now);

  const store = await tx.storeConfig.findUnique({
    where: { id: "default" },
    select: { homeState: true, gstRoundingMode: true },
  });
  if (!store) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");
  const homeState = store.homeState;
  const supplyState = input.supplyState?.trim() || homeState;

  // Load each line's catalog (GST rate / inclusive / HSN) for the tax computation.
  const loaded: { line: OrderInvoiceLineInput; cat: LoadedSaleUnit }[] = [];
  const taxInputs: LineInput[] = [];
  for (const line of input.lines) {
    const cat = await loadLineCatalog(tx, line.productId, line.saleUnitId);
    loaded.push({ line, cat });
    taxInputs.push({
      unitPrice: line.unitPrice,
      qty: new Decimal(line.quantity),
      gstRatePct: cat.gstRate,
      lineDiscount: new Decimal(0),
      priceInclusive: cat.priceInclusive,
    });
  }

  const doRound = (input.roundOff ?? true) && store.gstRoundingMode !== "NONE";
  const totals = computeInvoiceTotals({
    lines: taxInputs,
    supplyState,
    homeState,
    billDiscount: new Decimal(0),
    roundOff: doRound,
  });

  const { invoiceNo } = await nextInvoiceNo(tx, fy);

  const invoice = await tx.invoice.create({
    data: {
      fy,
      invoiceNo,
      customerId: input.customerId,
      customerNameSnap: input.customerName,
      customerGstinSnap: input.customerGstin,
      placeOfSupplyState: supplyState,
      date: now,
      taxableTotal: money2(totals.taxableTotal),
      discountTotal: money2(totals.discountTotal),
      cgstTotal: money2(totals.cgstTotal),
      sgstTotal: money2(totals.sgstTotal),
      igstTotal: money2(totals.igstTotal),
      roundOff: money2(totals.roundOff),
      grandTotal: money2(totals.grandTotal),
      status: "ACTIVE",
      orderId: input.orderId,
      lines: {
        create: loaded.map((l, i) => {
          const c = totals.lines[i]!;
          return {
            productId: l.line.productId,
            saleUnitId: l.line.saleUnitId,
            hsnCode: l.cat.hsnCode,
            saleQty: qty3(l.line.quantity),
            baseQty: l.line.baseQty,
            unitPrice: money2(l.line.unitPrice),
            lineDiscount: money2(c.discount),
            taxableValue: money2(c.taxableValue),
            gstRate: new Prisma.Decimal(l.cat.gstRate),
            cgst: money2(c.cgst),
            sgst: money2(c.sgst),
            igst: money2(c.igst),
          };
        }),
      },
    },
    select: { id: true, date: true, createdAt: true },
  });

  const grandPaise = toPaise(totals.grandTotal);
  const payments: PaymentDTO[] = [];
  if (input.paidOnline) {
    // Online (Razorpay) settlement is recorded as a CARD payment referencing the
    // gateway payment id — the order was prepaid, so the full grand total is paid.
    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        orderId: input.orderId,
        customerId: input.customerId,
        mode: "CARD",
        amount: money2(totals.grandTotal),
        reference: input.paymentReference ?? null,
      },
    });
    payments.push({ mode: "CARD", amount: grandPaise, reference: input.paymentReference ?? null });
  }

  return {
    id: invoice.id,
    fy,
    invoiceNo,
    invoiceType: "PAKKA",
    taxKind: totals.taxKind,
    placeOfSupplyState: supplyState,
    customerId: input.customerId,
    customerName: input.customerName,
    customerGstin: input.customerGstin,
    date: invoice.date.toISOString(),
    lines: loaded.map((l, i) => {
      const c = totals.lines[i]!;
      return {
        productId: l.line.productId,
        saleUnitId: l.line.saleUnitId,
        hsnCode: l.cat.hsnCode,
        saleQty: new Decimal(l.line.quantity).toFixed(3),
        baseQty: l.line.baseQty.toString(),
        unitPrice: toPaise(l.line.unitPrice),
        lineDiscount: toPaise(c.discount),
        taxableValue: toPaise(c.taxableValue),
        gstRatePct: l.cat.gstRate.toString(),
        cgst: toPaise(c.cgst),
        sgst: toPaise(c.sgst),
        igst: toPaise(c.igst),
        lineTotal: toPaise(c.lineTotal),
      };
    }),
    taxableTotal: toPaise(totals.taxableTotal),
    discountTotal: toPaise(totals.discountTotal),
    cgstTotal: toPaise(totals.cgstTotal),
    sgstTotal: toPaise(totals.sgstTotal),
    igstTotal: toPaise(totals.igstTotal),
    roundOff: toPaise(totals.roundOff),
    grandTotal: grandPaise,
    payments,
    amountPaid: input.paidOnline ? grandPaise : 0,
    balanceToLedger: input.paidOnline ? 0 : grandPaise,
    changeDue: 0,
    status: "ACTIVE",
    createdAt: invoice.createdAt.toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  S5 — Cancel + Credit note (the financial-correction loop).
//  No hard-delete of a financial record (13, 07 §10): an invoice is CANCELLED or
//  corrected by a credit note, never deleted, so the gapless series stays gapless.
//  Only Billing mints credit-note numbers + tax rows; only Inventory mutates stock
//  (here goods come back IN). Both are permission-guarded + audited in the SAME tx.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cancel a pakka invoice (04 Billing-cancel; owner-only `bill.cancel`). ONE
 * transaction:
 *  - flips status ACTIVE → CANCELLED with the required reason (a "void log"); the
 *    invoice row and its NUMBER are NEVER deleted, so the gapless series is intact.
 *  - reverses stock: each line's base qty comes back IN via a SALES_RETURN_IN
 *    movement (the original SALE_OUT is not erased — the movement ledger keeps both
 *    legs as the audit trail).
 *  - reverses the ledger: if the sale posted a khata receivable (INVOICE_DEBIT for
 *    this invoice), an offsetting CREDIT_NOTE_CREDIT is posted so the customer no
 *    longer owes the cancelled bill.
 *  - audits the cancel.
 * 422 on an already-cancelled invoice (idempotency in the business sense — you
 * cannot cancel twice).
 */
export async function cancelInvoice(
  id: Id,
  input: CancelInvoiceInput,
  ctx: BillingCtx,
): Promise<InvoiceDTO> {
  requirePermission(ctx.session, "bill.cancel");
  const data = cancelInvoiceSchema.parse(input);

  await runTx(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!inv) throw new DomainError(`Invoice ${id} not found`, "NOT_FOUND");
    if (inv.status === "CANCELLED") {
      throw new DomainError(`Invoice ${inv.invoiceNo} is already cancelled.`, "ALREADY_CANCELLED");
    }

    // 1. Reverse stock — goods come back IN, one SALES_RETURN_IN per line.
    for (const l of inv.lines) {
      await incrementStock(tx, l.productId, l.baseQty, "SALES_RETURN_IN", {
        refType: "CANCEL",
        refId: inv.id,
        reason: `cancel ${inv.invoiceNo}`,
        actorStaffId: ctx.session.userId,
      });
    }

    // 2. Reverse the ledger — net out any khata receivable this invoice posted.
    if (inv.customerId) {
      const debit = await tx.ledgerEntry.aggregate({
        where: { customerId: inv.customerId, refType: "INVOICE", refId: inv.id, type: "INVOICE_DEBIT" },
        _sum: { amount: true },
      });
      const owed = debit._sum.amount ?? new Decimal(0);
      if (owed.gt(0)) {
        await ledgerPost(tx, inv.customerId, "CREDIT_NOTE_CREDIT", owed, {
          refType: "CANCEL",
          refId: inv.id,
          note: `cancel ${inv.invoiceNo}`,
        });
      }
    }

    // 3. Flip status + record the void reason (no delete — gapless preserved).
    await tx.invoice.update({
      where: { id: inv.id },
      data: { status: "CANCELLED", cancelledReason: data.reason },
    });

    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "bill.cancel",
      action: "bill.cancel",
      targetType: "Invoice",
      targetId: inv.id,
      before: { status: "ACTIVE", invoiceNo: inv.invoiceNo },
      after: { status: "CANCELLED", reason: data.reason },
      requestId: ctx.requestId,
    });
  });

  const dto = await getInvoice(id);
  if (!dto) throw new DomainError(`Invoice ${id} not found`, "NOT_FOUND");
  return dto;
}

// ─────────────────── Credit note ───────────────────
export interface CreditNoteLineDTO {
  productId: Id;
  saleUnitId: Id;
  saleQty: string;
  baseQty: string;
  taxableValue: number; // paise
  gstRatePct: string;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number; // paise
}
export interface CreditNoteDTO {
  id: Id;
  fy: string;
  creditNoteNo: string;
  invoiceId: Id;
  invoiceNo: string;
  reason: string | null;
  taxKind: "CGST_SGST" | "IGST";
  lines: CreditNoteLineDTO[];
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  grandTotal: number;
  refundMode: "CASH" | "UPI" | "KHATA_ADJUST" | "GATEWAY";
  createdAt: string;
}

/**
 * Create a credit note against an ACTIVE pakka invoice (04 Billing-credit-note;
 * `bill.creditnote.create`). ONE transaction:
 *  1. nextCreditNoteNo(fy) — an INDEPENDENT gapless series from invoices (03 §7),
 *     allocated under a row lock IN THIS TX.
 *  2. for each returned line: locate the matching ORIGINAL InvoiceLine, validate the
 *     return qty does not exceed (billed − already-credited), price the return at the
 *     SAME effective unit price / discount ratio the invoice used (taxable + tax
 *     re-derived server-side, never trusted from the client), and bring the goods
 *     back IN via a SALES_RETURN_IN movement.
 *  3. insert CreditNote + CreditNoteLine[] referencing the invoice.
 *  4. settle the refund: KHATA_ADJUST posts a CREDIT_NOTE_CREDIT to the customer
 *     ledger; CASH/UPI/GATEWAY are recorded on the note's refundMode (the actual
 *     disbursement is a counter/gateway act, not a ledger move).
 *  5. audit. The ORIGINAL invoice stays ACTIVE (gapless intact).
 * Idempotent on the Idempotency-Key (04 §5). 400 when a return exceeds what was
 * billed; 422 when the invoice is cancelled.
 */
export async function createCreditNote(
  invoiceId: Id,
  input: CreateCreditNoteInput,
  ctx: BillingCtx,
): Promise<CreditNoteDTO> {
  requirePermission(ctx.session, "bill.creditnote.create");
  const data = createCreditNoteSchema.parse(input);

  const route = "POST /api/billing/pakka/{id}/credit-note";
  const requestHash = hashRequest({ invoiceId, ...data });
  if (ctx.idempotencyKey) {
    const { replay } = await findIdempotent<CreditNoteDTO>(
      ctx.idempotencyKey,
      ctx.session.userId,
      route,
      requestHash,
    );
    if (replay) return replay.response;
  }

  try {
    return await runTx(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { lines: true, creditNotes: { include: { lines: true } } },
      });
      if (!inv) throw new DomainError(`Invoice ${invoiceId} not found`, "NOT_FOUND");
      if (inv.status === "CANCELLED") {
        throw new DomainError(
          `Invoice ${inv.invoiceNo} is cancelled — issue corrections against an active invoice.`,
          "INVOICE_CANCELLED",
        );
      }

      const taxKind: "CGST_SGST" | "IGST" = inv.igstTotal.gt(0) ? "IGST" : "CGST_SGST";

      // Already-credited base qty per (productId, saleUnitId) from prior credit notes,
      // so partial returns across several notes never exceed what was billed.
      const creditedBase = new Map<string, Decimal>();
      for (const cn of inv.creditNotes) {
        for (const cl of cn.lines) {
          const key = `${cl.productId}::${cl.saleUnitId}`;
          creditedBase.set(key, (creditedBase.get(key) ?? new Decimal(0)).plus(cl.baseQty));
        }
      }

      const cnLines: {
        productId: string;
        saleUnitId: string;
        saleQty: Prisma.Decimal;
        baseQty: Prisma.Decimal;
        taxableValue: Prisma.Decimal;
        gstRate: Prisma.Decimal;
        cgst: Prisma.Decimal;
        sgst: Prisma.Decimal;
        igst: Prisma.Decimal;
        lineTotal: Decimal;
      }[] = [];

      for (const rl of data.lines) {
        const orig = inv.lines.find(
          (l) => l.productId === rl.productId && l.saleUnitId === rl.saleUnitId,
        );
        if (!orig) {
          throw new DomainError(
            `Line ${rl.productId}/${rl.saleUnitId} is not on invoice ${inv.invoiceNo}.`,
            "LINE_NOT_ON_INVOICE",
          );
        }

        // Convert the return sale-qty → base via the same factor the invoice used
        // (origBaseQty / origSaleQty), so a coil/metre return reverses exactly.
        const su = await loadLineCatalog(tx, rl.productId, rl.saleUnitId);
        const returnBase = toBase(rl.quantity, su);

        const key = `${rl.productId}::${rl.saleUnitId}`;
        const alreadyBase = creditedBase.get(key) ?? new Decimal(0);
        const remainingBase = orig.baseQty.minus(alreadyBase);
        if (new Decimal(returnBase).gt(remainingBase)) {
          throw new DomainError(
            `Return of ${rl.quantity} exceeds the billed quantity for ${rl.productId} on ${inv.invoiceNo}.`,
            "RETURN_EXCEEDS_BILLED",
          );
        }

        // Price the return as a PRO-RATA share of the original line's taxable + tax,
        // by the base-qty ratio. Using the persisted line figures guarantees the
        // credit reverses exactly what was charged (discount + MRP back-calc included).
        const ratio = new Decimal(returnBase).div(orig.baseQty); // 0 < ratio ≤ 1
        const taxable = new Decimal(orig.taxableValue).times(ratio);
        const cgst = new Decimal(orig.cgst).times(ratio);
        const sgst = new Decimal(orig.sgst).times(ratio);
        const igst = new Decimal(orig.igst).times(ratio);
        const lineTotal = taxable.plus(cgst).plus(sgst).plus(igst);

        // Goods back IN — one SALES_RETURN_IN per credited line.
        await incrementStock(tx, rl.productId, returnBase, "SALES_RETURN_IN", {
          refType: "CN",
          refId: inv.id,
          reason: `credit note vs ${inv.invoiceNo}`,
          actorStaffId: ctx.session.userId,
        });

        cnLines.push({
          productId: rl.productId,
          saleUnitId: rl.saleUnitId,
          saleQty: qty3(rl.quantity),
          baseQty: returnBase,
          taxableValue: money2(taxable),
          gstRate: new Prisma.Decimal(orig.gstRate),
          cgst: money2(cgst),
          sgst: money2(sgst),
          igst: money2(igst),
          lineTotal,
        });
      }

      const sum = (pick: (l: (typeof cnLines)[number]) => Decimal.Value) =>
        cnLines.reduce((a, l) => a.plus(new Decimal(pick(l))), new Decimal(0));
      const taxableTotal = sum((l) => l.taxableValue);
      const cgstTotal = sum((l) => l.cgst);
      const sgstTotal = sum((l) => l.sgst);
      const igstTotal = sum((l) => l.igst);
      const grandTotal = taxableTotal.plus(cgstTotal).plus(sgstTotal).plus(igstTotal);

      // Independent gapless CN number IN THIS TX (rollback burns none — 03 §7).
      const { creditNoteNo } = await nextCreditNoteNo(tx, inv.fy);

      const cn = await tx.creditNote.create({
        data: {
          fy: inv.fy,
          creditNoteNo,
          invoiceId: inv.id,
          reason: data.reason ?? null,
          taxableTotal: money2(taxableTotal),
          cgstTotal: money2(cgstTotal),
          sgstTotal: money2(sgstTotal),
          igstTotal: money2(igstTotal),
          grandTotal: money2(grandTotal),
          refundMode: data.refundMode,
          lines: {
            create: cnLines.map((l) => ({
              productId: l.productId,
              saleUnitId: l.saleUnitId,
              saleQty: l.saleQty,
              baseQty: l.baseQty,
              taxableValue: l.taxableValue,
              gstRate: l.gstRate,
            })),
          },
        },
        select: { id: true, createdAt: true },
      });

      // Refund settlement. KHATA_ADJUST reduces the customer's outstanding; CASH/UPI/
      // GATEWAY are settled outside the ledger (counter cash drawer / gateway refund).
      if (data.refundMode === "KHATA_ADJUST") {
        if (!inv.customerId) {
          throw new DomainError(
            "A khata-adjust refund needs a customer to credit; this invoice is a walk-in.",
            "KHATA_CUSTOMER_REQUIRED",
          );
        }
        await ledgerPost(tx, inv.customerId, "CREDIT_NOTE_CREDIT", grandTotal, {
          refType: "CN",
          refId: cn.id,
          note: creditNoteNo,
        });
      }

      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "bill.creditnote.create",
        action: "bill.creditnote.create",
        targetType: "CreditNote",
        targetId: cn.id,
        after: {
          creditNoteNo,
          invoiceNo: inv.invoiceNo,
          grandTotal: toPaise(grandTotal),
          refundMode: data.refundMode,
        },
        requestId: ctx.requestId,
      });

      const dto: CreditNoteDTO = {
        id: cn.id,
        fy: inv.fy,
        creditNoteNo,
        invoiceId: inv.id,
        invoiceNo: inv.invoiceNo,
        reason: data.reason ?? null,
        taxKind,
        lines: cnLines.map((l) => ({
          productId: l.productId,
          saleUnitId: l.saleUnitId,
          saleQty: l.saleQty.toString(),
          baseQty: l.baseQty.toString(),
          taxableValue: toPaise(l.taxableValue),
          gstRatePct: l.gstRate.toString(),
          cgst: toPaise(l.cgst),
          sgst: toPaise(l.sgst),
          igst: toPaise(l.igst),
          lineTotal: toPaise(l.lineTotal),
        })),
        taxableTotal: toPaise(taxableTotal),
        cgstTotal: toPaise(cgstTotal),
        sgstTotal: toPaise(sgstTotal),
        igstTotal: toPaise(igstTotal),
        grandTotal: toPaise(grandTotal),
        refundMode: data.refundMode,
        createdAt: cn.createdAt.toISOString(),
      };

      if (ctx.idempotencyKey) {
        await storeIdempotent(tx, ctx.idempotencyKey, ctx.session.userId, route, requestHash, dto, 201);
      }
      return dto;
    });
  } catch (e) {
    if (
      ctx.idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      (e.meta?.target as string[] | string | undefined)?.toString().includes("key")
    ) {
      const { replay } = await findIdempotent<CreditNoteDTO>(
        ctx.idempotencyKey,
        ctx.session.userId,
        route,
        requestHash,
      );
      if (replay) return replay.response;
    }
    throw e;
  }
}

/** List credit notes for an invoice (reprint / audit). Read-only. */
export async function listCreditNotesForInvoice(invoiceId: Id): Promise<CreditNoteDTO[]> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { invoiceNo: true, igstTotal: true },
  });
  if (!inv) return [];
  const notes = await prisma.creditNote.findMany({
    where: { invoiceId },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
  return notes.map((cn) => ({
    id: cn.id,
    fy: cn.fy,
    creditNoteNo: cn.creditNoteNo,
    invoiceId,
    invoiceNo: inv.invoiceNo,
    reason: cn.reason,
    taxKind: cn.igstTotal.gt(0) ? "IGST" : "CGST_SGST",
    lines: cn.lines.map((l) => {
      const lineTotal = l.taxableValue;
      return {
        productId: l.productId,
        saleUnitId: l.saleUnitId,
        saleQty: l.saleQty.toString(),
        baseQty: l.baseQty.toString(),
        taxableValue: toPaise(l.taxableValue),
        gstRatePct: l.gstRate.toString(),
        cgst: 0,
        sgst: 0,
        igst: 0,
        lineTotal: toPaise(lineTotal),
      };
    }),
    taxableTotal: toPaise(cn.taxableTotal),
    cgstTotal: toPaise(cn.cgstTotal),
    sgstTotal: toPaise(cn.sgstTotal),
    igstTotal: toPaise(cn.igstTotal),
    grandTotal: toPaise(cn.grandTotal),
    refundMode: (cn.refundMode ?? "CASH") as "CASH" | "UPI" | "KHATA_ADJUST" | "GATEWAY",
    createdAt: cn.createdAt.toISOString(),
  }));
}

// ─────────────────── Invoice reads (reprint) ───────────────────
export interface InvoicePage {
  data: InvoiceDTO[];
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

const invoiceInclude = {
  lines: true,
  payments: true,
} satisfies Prisma.InvoiceInclude;

type InvoiceWith = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

function toInvoiceDTO(inv: InvoiceWith): InvoiceDTO {
  const taxKind = inv.igstTotal.gt(0) ? "IGST" : "CGST_SGST";
  const payments: PaymentDTO[] = inv.payments.map((p) => ({
    mode: p.mode,
    amount: toPaise(p.amount),
    reference: p.reference,
  }));
  const amountPaid = payments.reduce((a, p) => a + p.amount, 0);
  const grandPaise = toPaise(inv.grandTotal);
  return {
    id: inv.id,
    fy: inv.fy,
    invoiceNo: inv.invoiceNo,
    invoiceType: "PAKKA",
    taxKind,
    placeOfSupplyState: inv.placeOfSupplyState,
    customerId: inv.customerId,
    customerName: inv.customerNameSnap,
    customerGstin: inv.customerGstinSnap,
    date: inv.date.toISOString(),
    lines: inv.lines.map((l) => ({
      productId: l.productId,
      saleUnitId: l.saleUnitId,
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
    taxableTotal: toPaise(inv.taxableTotal),
    discountTotal: toPaise(inv.discountTotal),
    cgstTotal: toPaise(inv.cgstTotal),
    sgstTotal: toPaise(inv.sgstTotal),
    igstTotal: toPaise(inv.igstTotal),
    roundOff: toPaise(inv.roundOff),
    grandTotal: grandPaise,
    payments,
    amountPaid,
    balanceToLedger: Math.max(grandPaise - amountPaid, 0),
    changeDue: 0,
    status: inv.status,
    createdAt: inv.createdAt.toISOString(),
  };
}

/**
 * List invoices for reprint / day-book (04 — bill.read enforced at transport).
 * Filter by status / date range / customer / payment mode; cursor-paginated by id
 * (DESC — newest first). All filters are optional + additive: omitting one matches
 * the prior (unfiltered) behaviour.
 */
export async function listInvoices(query: ListInvoicesQuery = {}): Promise<InvoicePage> {
  const { status, from, to, customerId, paymentMode, cursor, limit } =
    listInvoicesQuerySchema.parse(query);

  const where: Prisma.InvoiceWhereInput = {};
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (paymentMode) where.payments = { some: { mode: paymentMode } };
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  const afterId = decodeCursor(cursor);
  const rows = await prisma.invoice.findMany({
    where,
    include: invoiceInclude,
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    data: page.map(toInvoiceDTO),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
    },
  };
}

/** Single invoice for reprint (A4/A5/thermal). Returns null if missing. */
export async function getInvoice(id: Id): Promise<InvoiceDTO | null> {
  const inv = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  return inv ? toInvoiceDTO(inv) : null;
}

// ─────────────────── Store config (read-only, for POS + print branding) ───────────────────
export interface StoreConfigDTO {
  name: string;
  gstin: string | null;
  homeState: string;
  address: string | null;
  logoKey: string | null;
  bankDetails: string | null;
  invoiceTerms: string | null;
  gstRoundingMode: string;
}

/**
 * Read-only StoreConfig for the POS (place-of-supply default = homeState) and the
 * print templates (logo/name/address/GSTIN/bank/T&C — 14-impl-plan Chunk 8). Full
 * settings management (settings.write) is S7; S4 only needs to read the single
 * "default" row. Returns null if the store has not been seeded.
 */
export async function getStoreConfig(): Promise<StoreConfigDTO | null> {
  const s = await prisma.storeConfig.findUnique({ where: { id: "default" } });
  if (!s) return null;
  return {
    name: s.name,
    gstin: s.gstin,
    homeState: s.homeState,
    address: s.address,
    logoKey: s.logoKey,
    bankDetails: s.bankDetails,
    invoiceTerms: s.invoiceTerms,
    gstRoundingMode: s.gstRoundingMode,
  };
}

// Re-export the billing Zod surface + pure totals so transport imports validation
// and the (tested) tax math from @hardware/core only.
export * from "./schema";
export * from "./totals";
