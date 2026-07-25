// Khata ledger (S5; 13 §7, 04 Khata/Ledger). The `Customer` party here is the
// billing/credit party (counter or online) — DISTINCT from the storefront
// `CustomerAccount` login (13 §7). The ledger is an append-only sequence of signed
// LedgerEntry rows: a sale on khata posts a DEBIT (+), a receipt or credit-note
// posts a CREDIT (−). `outstanding = Σ amount` by the +debit/−credit convention.
//
// `post(tx, …)` is the kernel finalizePakka calls inside the invoice transaction
// for a khata/part-payment balance (one user action = one tx — 03 §2); it never
// opens its own transaction. The CRUD / payment / aging services each open ONE
// prisma.$transaction (mutations) or are read-only (statement/aging).
import Decimal from "decimal.js";
import { Prisma, prisma, runTx, type Tx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { fromPaise, toPaise } from "../shared/money";
import { findIdempotent, hashRequest, storeIdempotent } from "../shared/idempotency";
import type { Id } from "../shared/types";
import type { LedgerEntryType } from "@hardware/db";
import {
  upsertCustomerSchema,
  listCustomersQuerySchema,
  statementQuerySchema,
  recordPaymentSchema,
  triggerReminderSchema,
  type UpsertCustomerInput,
  type ListCustomersQuery,
  type StatementQuery,
  type AgingBucket,
  type RecordPaymentInput,
  type TriggerReminderInput,
} from "./schema";

export interface LedgerCtx {
  session: Session;
  requestId?: string | null;
  /** Idempotency-Key header (ledger payments are money-moving → idempotent — 04 §5). */
  idempotencyKey?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

/** A 2dp Prisma Decimal (money is @db.Decimal(14,2)). */
function money2(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(2));
}

// ════════════════════════════════════════════════════════════════════════════
//  Ledger kernel — post a signed entry inside the caller's transaction.
//  Called by billing.finalizePakka (khata/part-payment), createCreditNote and
//  cancelInvoice; never opens its own tx (03 §2).
// ════════════════════════════════════════════════════════════════════════════

export interface LedgerRef {
  refType?: string | null; // INVOICE | PAYMENT | CN
  refId?: string | null;
  note?: string | null;
}

/**
 * Post ONE signed LedgerEntry into the customer's khata, inside the caller's
 * transaction. The `amount` is RUPEES (Decimal/number), signed per the 13 §7
 * convention: a DEBIT type (INVOICE_DEBIT / OPENING / +ADJUSTMENT) carries a
 * POSITIVE amount (increases what the customer owes); a CREDIT type
 * (PAYMENT_CREDIT / CREDIT_NOTE_CREDIT) carries a NEGATIVE amount (reduces it).
 * The caller passes the magnitude and the type; this normalises the sign so the
 * running `outstanding = Σ amount` is always correct regardless of caller hygiene.
 * Returns the created entry id.
 */
export async function post(
  tx: Tx,
  customerId: string,
  type: LedgerEntryType,
  amount: Decimal.Value,
  ref: LedgerRef = {},
): Promise<string> {
  const magnitude = new Decimal(amount).abs();
  const isCredit = type === "PAYMENT_CREDIT" || type === "CREDIT_NOTE_CREDIT";
  const signed = isCredit ? magnitude.negated() : magnitude;

  const row = await tx.ledgerEntry.create({
    data: {
      customerId,
      type,
      amount: money2(signed),
      refType: ref.refType ?? null,
      refId: ref.refId ?? null,
      note: ref.note ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

// ════════════════════════════════════════════════════════════════════════════
//  Counter-customer CRUD (customers.*) — the Customer billing party (13 §7).
// ════════════════════════════════════════════════════════════════════════════

export interface CustomerDTO {
  id: Id;
  name: string;
  phone: string | null;
  gstin: string | null;
  type: "RETAIL" | "WHOLESALE";
  creditLimit: number | null; // paise
  /** Current outstanding (paise; + = owes the shop). Present on getCustomer. */
  outstanding?: number;
  createdAt: string;
}
export interface CustomerPage {
  data: CustomerDTO[];
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

function toCustomerDTO(c: {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  type: "RETAIL" | "WHOLESALE";
  creditLimit: Prisma.Decimal | null;
  createdAt: Date;
}): CustomerDTO {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    gstin: c.gstin,
    type: c.type,
    creditLimit: c.creditLimit === null ? null : toPaise(c.creditLimit),
    createdAt: c.createdAt.toISOString(),
  };
}

/** True when an aging breakdown has unpaid debt in the requested bucket. PURE. */
export function inAgingBucket(a: AgingDTO, bucket: AgingBucket): boolean {
  switch (bucket) {
    case "current":
      return a.bucket0to30 > 0;
    case "b31to60":
      return a.bucket31to60 > 0;
    case "b60plus":
      return a.bucket60plus > 0;
  }
}

/**
 * Counter-customer directory (customers.read enforced at transport). Cursor-
 * paginated by id; `q` matches name/phone/gstin.
 *
 * Filters (all optional + additive — omitting one keeps the prior behaviour):
 *  - q — name/phone/gstin substring match (unchanged).
 *  - hasOutstanding — only customers whose net outstanding > 0.
 *  - agingBucket — only customers with unpaid debt in current | b31to60 | b60plus.
 *
 * `hasOutstanding` / `agingBucket` are DERIVED from a Σ over LedgerEntry (and the FIFO
 * aging), not stored columns, so they cannot be pushed into the SQL WHERE. When either
 * is set we over-fetch a wider window, compute outstanding/aging per candidate, filter
 * in-memory, and DISABLE cursor pagination (nextCursor stays null — first page only),
 * mirroring listStock's lowStockOnly. The plain `q`-only path is unchanged and keeps
 * full cursor pagination.
 */
export async function listCustomers(query: ListCustomersQuery = {}): Promise<CustomerPage> {
  const { q, hasOutstanding, agingBucket, cursor, limit } = listCustomersQuerySchema.parse(query);
  const derived = hasOutstanding === true || agingBucket !== undefined;

  const where: Prisma.CustomerWhereInput = {};
  if (q && q.length > 0) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { gstin: { contains: q, mode: "insensitive" } },
    ];
  }

  const afterId = derived ? undefined : decodeCursor(cursor);
  // For a derived filter, over-fetch (the in-memory predicate prunes the set) so a
  // first page still fills; otherwise the classic cursor over-fetch (+1).
  const overFetch = derived ? Math.max(limit * 4, 200) : limit + 1;
  const rows = await prisma.customer.findMany({
    where,
    orderBy: { id: "asc" },
    take: overFetch,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  if (!derived) {
    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;
    return {
      data: page.map(toCustomerDTO),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
      },
    };
  }

  // Derived path: compute aging (which carries net outstanding) per candidate, then
  // apply the predicate(s). aging() is the single FIFO source of truth (no drift).
  const matched: CustomerDTO[] = [];
  for (const c of rows) {
    if (matched.length >= limit) break;
    const a = await aging(c.id);
    if (hasOutstanding === true && a.outstanding <= 0) continue;
    if (agingBucket !== undefined && !inAgingBucket(a, agingBucket)) continue;
    const dto = toCustomerDTO(c);
    dto.outstanding = a.outstanding;
    matched.push(dto);
  }

  // Cursor pagination is disabled for the derived filters (first page only).
  return { data: matched, pageInfo: { hasNextPage: false, nextCursor: null } };
}

/** Single counter customer with current outstanding. Returns null if missing. */
export async function getCustomer(id: Id): Promise<CustomerDTO | null> {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) return null;
  const dto = toCustomerDTO(c);
  dto.outstanding = await outstanding(id);
  return dto;
}

/** Create a counter customer (name/phone/GSTIN/type). Audited. */
export async function createCustomer(input: UpsertCustomerInput, ctx: LedgerCtx): Promise<CustomerDTO> {
  requirePermission(ctx.session, "customers.write");
  const data = upsertCustomerSchema.parse(input);

  const created = await runTx(async (tx) => {
    const c = await tx.customer.create({
      data: {
        name: data.name,
        phone: data.phone ?? null,
        gstin: data.gstin ?? null,
        type: data.type,
        creditLimit: data.creditLimit != null ? money2(fromPaise(data.creditLimit)) : null,
      },
    });
    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "customers.write",
      action: "customer.create",
      targetType: "Customer",
      targetId: c.id,
      after: { name: c.name, type: c.type },
      requestId: ctx.requestId,
    });
    return c;
  });
  return toCustomerDTO(created);
}

// ════════════════════════════════════════════════════════════════════════════
//  Statement / outstanding / aging (read-only).
// ════════════════════════════════════════════════════════════════════════════

export interface StatementEntryDTO {
  id: Id;
  type: LedgerEntryType;
  amount: number; // signed paise (+ debit / − credit)
  refType: string | null;
  refId: string | null;
  note: string | null;
  /** Running balance after this entry (paise). */
  balance: number;
  createdAt: string;
}
export interface StatementDTO {
  customerId: Id;
  customerName: string;
  entries: StatementEntryDTO[];
  /** Balance carried in from all entries BEFORE `from` (paise; 0 when no `from`). */
  openingBalance: number;
  outstanding: number; // paise (closing balance — full ledger, unaffected by the window)
}

/**
 * Full khata statement for a customer: every ledger entry oldest-first with a
 * running balance, and the closing outstanding. Read-only (ledger.read enforced at
 * transport; ownership for a .own customer is enforced at the storefront).
 *
 * Optional `from`/`to` (ISO) window the ENTRIES shown (additive — omit for the full
 * history). The running balance stays correct across a window: every entry strictly
 * before `from` is folded into `openingBalance`, and each shown entry's `balance`
 * continues from there. `outstanding` is ALWAYS the closing balance of the WHOLE
 * ledger (every entry, windowed or not), so the headline figure never changes with
 * the filter — only the visible rows do.
 */
export async function getStatement(
  customerId: Id,
  query: StatementQuery = {},
): Promise<StatementDTO> {
  const { from, to } = statementQuerySchema.parse(query);
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true },
  });
  if (!customer) throw new DomainError(`Customer ${customerId} not found`, "NOT_FOUND");

  const rows = await prisma.ledgerEntry.findMany({
    where: { customerId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  let running = new Decimal(0);
  let openingBalance = new Decimal(0);
  const entries: StatementEntryDTO[] = [];
  for (const e of rows) {
    running = running.plus(e.amount);
    // Entries strictly before `from` accumulate into the opening balance (not shown).
    if (fromDate && e.createdAt < fromDate) {
      openingBalance = running;
      continue;
    }
    // Entries after `to` are excluded from the visible rows but still count toward the
    // whole-ledger `outstanding` computed below.
    if (toDate && e.createdAt > toDate) continue;
    entries.push({
      id: e.id,
      type: e.type,
      amount: toPaise(e.amount),
      refType: e.refType,
      refId: e.refId,
      note: e.note,
      balance: toPaise(running),
      createdAt: e.createdAt.toISOString(),
    });
  }

  return {
    customerId: customer.id,
    customerName: customer.name,
    entries,
    openingBalance: toPaise(openingBalance),
    outstanding: toPaise(running), // closing balance of the full ledger
  };
}

/** Current outstanding for a customer in paise (+ = owes the shop). */
export async function outstanding(customerId: Id): Promise<number> {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { customerId },
    _sum: { amount: true },
  });
  return toPaise(agg._sum.amount ?? new Decimal(0));
}

export interface AgingDTO {
  customerId: Id;
  /** Net outstanding (paise). Buckets below only ever apply to a POSITIVE balance. */
  outstanding: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket60plus: number;
}

/**
 * Age the customer's outstanding into 0-30 / 31-60 / 60+ day buckets (04 Ledger).
 * Approach: net the ledger to a single outstanding, then attribute it to the
 * OLDEST unpaid debits first (FIFO) — payments and credit notes settle the oldest
 * invoices first. Each remaining (unsettled) debit is bucketed by its age. A net
 * credit balance (customer in credit) buckets to zero everywhere.
 */
export async function aging(customerId: Id, now: Date = new Date()): Promise<AgingDTO> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { customerId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { type: true, amount: true, createdAt: true },
  });

  // Net credits (payments / credit notes) against the oldest debits first (FIFO).
  // `debits` holds each still-owed debit with its age; credit magnitude is consumed
  // off the front.
  const debits: { remaining: Decimal; createdAt: Date }[] = [];
  let creditPool = new Decimal(0);

  for (const e of rows) {
    if (e.amount.gt(0)) {
      debits.push({ remaining: e.amount, createdAt: e.createdAt });
    } else if (e.amount.lt(0)) {
      creditPool = creditPool.plus(e.amount.abs());
    }
  }

  // Apply the pooled credit to the oldest debits first.
  for (const d of debits) {
    if (creditPool.lte(0)) break;
    const applied = Decimal.min(d.remaining, creditPool);
    d.remaining = d.remaining.minus(applied);
    creditPool = creditPool.minus(applied);
  }

  let b0 = new Decimal(0);
  let b31 = new Decimal(0);
  let b60 = new Decimal(0);
  const DAY = 24 * 60 * 60 * 1000;
  for (const d of debits) {
    if (d.remaining.lte(0)) continue;
    const ageDays = Math.floor((now.getTime() - d.createdAt.getTime()) / DAY);
    if (ageDays <= 30) b0 = b0.plus(d.remaining);
    else if (ageDays <= 60) b31 = b31.plus(d.remaining);
    else b60 = b60.plus(d.remaining);
  }

  // Net outstanding may be negative if creditPool exceeded debits (customer in credit).
  const net = b0.plus(b31).plus(b60).minus(creditPool);
  return {
    customerId,
    outstanding: toPaise(net),
    bucket0to30: toPaise(b0),
    bucket31to60: toPaise(b31),
    bucket60plus: toPaise(b60),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Record a khata receipt (part-payment) — idempotent (04 §5).
// ════════════════════════════════════════════════════════════════════════════

export interface LedgerPaymentDTO {
  paymentId: Id;
  ledgerEntryId: Id;
  customerId: Id;
  amount: number; // paise
  mode: "CASH" | "UPI" | "CARD";
  reference: string | null;
  outstandingAfter: number; // paise
  createdAt: string;
}

/**
 * Record a khata receipt against a customer's outstanding (04 Ledger). ONE
 * transaction: insert a Payment row (customer-scoped, no invoice), post a
 * PAYMENT_CREDIT to the ledger (reduces outstanding), audit. Idempotent on the
 * Idempotency-Key — a retry replays the original receipt, never double-crediting.
 */
export async function recordPayment(
  customerId: Id,
  input: RecordPaymentInput,
  ctx: LedgerCtx,
): Promise<LedgerPaymentDTO> {
  requirePermission(ctx.session, "ledger.write");
  const data = recordPaymentSchema.parse(input);

  const route = "POST /api/ledger/{id}/payments";
  const requestHash = hashRequest({ customerId, ...data });
  if (ctx.idempotencyKey) {
    const { replay } = await findIdempotent<LedgerPaymentDTO>(
      ctx.idempotencyKey,
      ctx.session.userId,
      route,
      requestHash,
    );
    if (replay) return replay.response;
  }

  try {
    return await runTx(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) throw new DomainError(`Customer ${customerId} not found`, "NOT_FOUND");

      const amountRupees = fromPaise(data.amount);
      const payment = await tx.payment.create({
        data: {
          customerId,
          mode: data.mode,
          amount: money2(amountRupees),
          reference: data.reference ?? null,
        },
        select: { id: true },
      });

      const ledgerEntryId = await post(tx, customerId, "PAYMENT_CREDIT", amountRupees, {
        refType: "PAYMENT",
        refId: payment.id,
        note: data.note ?? null,
      });

      // Outstanding after this credit (computed inside the tx for a consistent read).
      const agg = await tx.ledgerEntry.aggregate({
        where: { customerId },
        _sum: { amount: true },
      });
      const outstandingAfter = toPaise(agg._sum.amount ?? new Decimal(0));

      await audit(tx, {
        ...auditMeta(ctx.session),
        permissionUsed: "ledger.write",
        action: "ledger.payment",
        targetType: "Customer",
        targetId: customerId,
        after: { amount: data.amount, mode: data.mode, paymentId: payment.id },
        requestId: ctx.requestId,
      });

      const dto: LedgerPaymentDTO = {
        paymentId: payment.id,
        ledgerEntryId,
        customerId,
        amount: data.amount,
        mode: data.mode,
        reference: data.reference ?? null,
        outstandingAfter,
        createdAt: new Date().toISOString(),
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
      const { replay } = await findIdempotent<LedgerPaymentDTO>(
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

// ════════════════════════════════════════════════════════════════════════════
//  Trigger a dues reminder (queue stub for S7).
// ════════════════════════════════════════════════════════════════════════════

export interface ReminderResult {
  customerId: Id;
  channel: "EMAIL" | "SMS";
  outstanding: number; // paise
  /** Queued vs skipped (nothing owed). The real QStash enqueue lands in S7. */
  queued: boolean;
}

/**
 * Trigger a dues reminder for a customer (04 Ledger). In S5 this recomputes the
 * outstanding and, when positive, "queues" a reminder — the actual QStash enqueue +
 * Resend/MSG91 send is wired in S7 (jobs). It is a no-op (queued:false) when nothing
 * is owed, so we never nag a settled customer. Audited as a ledger.write act.
 */
export async function triggerReminder(
  customerId: Id,
  input: TriggerReminderInput,
  ctx: LedgerCtx,
): Promise<ReminderResult> {
  requirePermission(ctx.session, "ledger.write");
  const data = triggerReminderSchema.parse(input);

  return await runTx(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new DomainError(`Customer ${customerId} not found`, "NOT_FOUND");

    const agg = await tx.ledgerEntry.aggregate({
      where: { customerId },
      _sum: { amount: true },
    });
    const owed = toPaise(agg._sum.amount ?? new Decimal(0));
    const queued = owed > 0;

    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "ledger.write",
      action: "ledger.reminder",
      targetType: "Customer",
      targetId: customerId,
      after: { channel: data.channel, outstanding: owed, queued },
      requestId: ctx.requestId,
    });

    // TODO(S7): enqueue the reminder on QStash → Resend (EMAIL) / MSG91 (SMS).
    return { customerId, channel: data.channel, outstanding: owed, queued };
  });
}

// Re-export the ledger Zod surface so transport imports validation from @hardware/core only.
export * from "./schema";
