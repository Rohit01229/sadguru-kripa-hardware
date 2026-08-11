// Expenses (21b) — myBillBook's Expenses screen.
//
// The shop's money going OUT that is not stock: rent, electricity, wages, freight, tea.
// Stock purchases are NOT expenses here; they already have a home in goods receipts,
// and counting them twice would make every total wrong.
//
// Deliberately NOT double-entry. There is no P&L for it to feed yet, and half an
// accounting system is worse than an honest register. What this answers today is the
// question a shopkeeper actually asks: "where did my month go?"
import Decimal from "decimal.js";
import { Prisma, prisma, runTx, type Tx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise, fromPaise } from "../shared/money";
import { backCalcTaxable } from "../shared/tax";
import type { Id } from "../shared/types";
import { financialYear } from "../billing/numbering";
import {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
  createExpenseCategorySchema,
  STARTER_EXPENSE_CATEGORIES,
  type CreateExpenseInput,
  type UpdateExpenseInput,
  type ListExpensesQuery,
  type CreateExpenseCategoryInput,
  type ExpensePaymentMode,
} from "./schema";

export interface ExpenseCtx {
  session: Session;
  requestId?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

function money2(v: Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(v).toFixed(2));
}

// ─────────────────── Categories ───────────────────

/**
 * Seed the starter categories on first use — the same "no masters wall" rule the
 * catalog follows (19 §4). A shop must never be sent to a set-up screen before it can
 * record that it paid the electricity bill. Only seeds when the shop has NONE, so a
 * curated list is never touched.
 */
export async function ensureExpenseCategories(shopId: string): Promise<void> {
  const existing = await prisma.expenseCategory.count({ where: { shopId } });
  if (existing > 0) return;
  await prisma.expenseCategory.createMany({
    data: STARTER_EXPENSE_CATEGORIES.map((name) => ({ shopId, name, isSeeded: true })),
    skipDuplicates: true,
  });
}

export interface ExpenseCategoryDTO {
  id: Id;
  name: string;
  isSeeded: boolean;
}

export async function listExpenseCategories(shopId: string): Promise<ExpenseCategoryDTO[]> {
  await ensureExpenseCategories(shopId);
  const rows = await prisma.expenseCategory.findMany({
    where: { shopId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isSeeded: true },
  });
  return rows;
}

export async function createExpenseCategory(
  input: CreateExpenseCategoryInput,
  ctx: ExpenseCtx,
): Promise<ExpenseCategoryDTO> {
  requirePermission(ctx.session, "expenses.write");
  const shopId = requireShop(ctx.session);
  const data = createExpenseCategorySchema.parse(input);

  const existing = await prisma.expenseCategory.findFirst({
    where: { shopId, name: { equals: data.name, mode: "insensitive" } },
    select: { id: true, name: true, isSeeded: true },
  });
  // Return the existing row rather than erroring: the user's intent ("file things under
  // this name") is satisfied either way, and a duplicate-name error here is pure friction.
  if (existing) return existing;

  const row = await prisma.expenseCategory.create({
    data: { shopId, name: data.name },
    select: { id: true, name: true, isSeeded: true },
  });
  return row;
}

// ─────────────────── Numbering ───────────────────
interface CounterRow {
  lastNo: number;
}

async function nextExpenseNo(tx: Tx, shopId: string, fy: string): Promise<string> {
  await tx.expenseCounter.upsert({
    where: { shopId_fy: { shopId, fy } },
    create: { shopId, fy, lastNo: 0 },
    update: {},
  });
  const rows = await tx.$queryRaw<CounterRow[]>`
    UPDATE "ExpenseCounter"
    SET "lastNo" = "lastNo" + 1
    WHERE "shopId" = ${shopId} AND "fy" = ${fy}
    RETURNING "lastNo"`;
  return `EXP/${fy}/${String(rows[0]!.lastNo).padStart(6, "0")}`;
}

// ─────────────────── DTO ───────────────────
export interface ExpenseDTO {
  id: Id;
  fy: string;
  expenseNo: string;
  date: string;
  categoryId: Id;
  categoryName: string;
  paidTo: string | null;
  paymentMode: ExpensePaymentMode;
  reference: string | null;
  /** All paise. `totalAmount` is what left the till; `taxableAmount` excludes GST. */
  totalAmount: number;
  taxableAmount: number;
  gstRatePct: string;
  cgst: number;
  sgst: number;
  igst: number;
  /** cgst + sgst + igst, so callers do not re-add it. */
  taxAmount: number;
  supplierGstin: string | null;
  notes: string | null;
  createdAt: string;
}

const expenseInclude = {
  category: { select: { name: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseWith = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function toExpenseDTO(e: ExpenseWith): ExpenseDTO {
  const cgst = toPaise(e.cgst);
  const sgst = toPaise(e.sgst);
  const igst = toPaise(e.igst);
  return {
    id: e.id,
    fy: e.fy,
    expenseNo: e.expenseNo,
    date: e.date.toISOString(),
    categoryId: e.categoryId,
    categoryName: e.category.name,
    paidTo: e.paidTo,
    paymentMode: e.paymentMode as ExpensePaymentMode,
    reference: e.reference,
    totalAmount: toPaise(e.totalAmount),
    taxableAmount: toPaise(e.taxableAmount),
    gstRatePct: e.gstRate.toString(),
    cgst,
    sgst,
    igst,
    taxAmount: cgst + sgst + igst,
    supplierGstin: e.supplierGstin,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Split the amount paid into taxable value + tax.
 *
 * The shopkeeper types the GROSS — ₹1,180 for freight, not ₹1,000 + ₹180 — because
 * that is the number on the bill and in the bank statement. So the taxable value is
 * back-calculated with the same helper MRP-inclusive pricing uses, and the tax lands as
 * CGST+SGST or IGST depending on where the supplier is.
 */
export function splitAmount(totalPaise: number, gstRatePct: number, interState: boolean) {
  const total = fromPaise(totalPaise);
  if (gstRatePct <= 0) {
    return { taxable: total, cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0) };
  }
  const taxable = backCalcTaxable(total, gstRatePct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const tax = total.minus(taxable);
  if (interState) {
    return { taxable, cgst: new Decimal(0), sgst: new Decimal(0), igst: tax };
  }
  // Give the remainder to SGST so the two halves sum EXACTLY to the tax — no paisa lost.
  const cgst = tax.div(2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { taxable, cgst, sgst: tax.minus(cgst), igst: new Decimal(0) };
}

// ─────────────────── Writes ───────────────────
export async function createExpense(input: CreateExpenseInput, ctx: ExpenseCtx): Promise<ExpenseDTO> {
  requirePermission(ctx.session, "expenses.write");
  const shopId = requireShop(ctx.session);
  const data = createExpenseSchema.parse(input);

  const category = await prisma.expenseCategory.findFirst({
    where: { id: data.categoryId, shopId },
    select: { id: true },
  });
  if (!category) throw new DomainError("That expense category was not found.", "NOT_FOUND");

  const date = data.date ? new Date(data.date) : new Date();
  const fy = financialYear(date);
  const split = splitAmount(data.totalAmount, data.gstRatePct, data.interState);

  const row = await runTx(async (tx) => {
    const expenseNo = await nextExpenseNo(tx, shopId, fy);
    const created = await tx.expense.create({
      data: {
        shopId,
        fy,
        expenseNo,
        date,
        categoryId: data.categoryId,
        paidTo: data.paidTo ?? null,
        paymentMode: data.paymentMode,
        reference: data.reference ?? null,
        totalAmount: money2(fromPaise(data.totalAmount)),
        taxableAmount: money2(split.taxable),
        gstRate: new Prisma.Decimal(new Decimal(data.gstRatePct).toFixed(2)),
        cgst: money2(split.cgst),
        sgst: money2(split.sgst),
        igst: money2(split.igst),
        supplierGstin: data.supplierGstin ?? null,
        notes: data.notes ?? null,
        createdById: ctx.session.userId,
      },
      include: expenseInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: "expenses.write",
      action: "expense.create",
      targetType: "Expense",
      targetId: created.id,
      after: { expenseNo, total: created.totalAmount.toString(), category: created.category.name },
      requestId: ctx.requestId,
    });
    return created;
  });

  return toExpenseDTO(row);
}

export async function updateExpense(input: UpdateExpenseInput, ctx: ExpenseCtx): Promise<ExpenseDTO> {
  requirePermission(ctx.session, "expenses.write");
  const shopId = requireShop(ctx.session);
  const data = updateExpenseSchema.parse(input);

  const split = splitAmount(data.totalAmount, data.gstRatePct, data.interState);

  const row = await runTx(async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id: data.id, shopId },
      select: { id: true, totalAmount: true, expenseNo: true },
    });
    if (!existing) throw new DomainError("That expense was not found.", "NOT_FOUND");

    const category = await tx.expenseCategory.findFirst({
      where: { id: data.categoryId, shopId },
      select: { id: true },
    });
    if (!category) throw new DomainError("That expense category was not found.", "NOT_FOUND");

    const updated = await tx.expense.update({
      where: { id: existing.id },
      data: {
        // The number is NOT re-minted when the date moves — it is already written in
        // whatever register or photo the shop keeps.
        ...(data.date ? { date: new Date(data.date) } : {}),
        categoryId: data.categoryId,
        paidTo: data.paidTo ?? null,
        paymentMode: data.paymentMode,
        reference: data.reference ?? null,
        totalAmount: money2(fromPaise(data.totalAmount)),
        taxableAmount: money2(split.taxable),
        gstRate: new Prisma.Decimal(new Decimal(data.gstRatePct).toFixed(2)),
        cgst: money2(split.cgst),
        sgst: money2(split.sgst),
        igst: money2(split.igst),
        supplierGstin: data.supplierGstin ?? null,
        notes: data.notes ?? null,
      },
      include: expenseInclude,
    });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: "expenses.write",
      action: "expense.update",
      targetType: "Expense",
      targetId: existing.id,
      before: { total: existing.totalAmount.toString() },
      after: { total: updated.totalAmount.toString() },
      requestId: ctx.requestId,
    });
    return updated;
  });

  return toExpenseDTO(row);
}

/**
 * Remove an expense. A real delete, unlike an invoice — a mistyped expense is a typo
 * in a private register, not a document a customer is holding. The full row is
 * snapshotted into the audit log first, so it stays recoverable.
 */
export async function deleteExpense(id: Id, ctx: ExpenseCtx): Promise<void> {
  requirePermission(ctx.session, "expenses.write");
  const shopId = requireShop(ctx.session);

  await runTx(async (tx) => {
    const existing = await tx.expense.findFirst({ where: { id, shopId }, include: expenseInclude });
    if (!existing) throw new DomainError("That expense was not found.", "NOT_FOUND");

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: "expenses.write",
      action: "expense.delete",
      targetType: "Expense",
      targetId: id,
      before: {
        expenseNo: existing.expenseNo,
        date: existing.date.toISOString(),
        category: existing.category.name,
        paidTo: existing.paidTo,
        paymentMode: existing.paymentMode,
        total: existing.totalAmount.toString(),
        notes: existing.notes,
      },
      requestId: ctx.requestId,
    });
    await tx.expense.delete({ where: { id } });
  });
}

// ─────────────────── Reads ───────────────────
export interface ExpensePage {
  data: ExpenseDTO[];
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

export async function listExpenses(
  shopId: string,
  query: ListExpensesQuery = {},
): Promise<ExpensePage> {
  const { from, to, categoryId, paymentMode, q, cursor, limit } =
    listExpensesQuerySchema.parse(query);

  const where: Prisma.ExpenseWhereInput = { shopId };
  if (categoryId) where.categoryId = categoryId;
  if (paymentMode) where.paymentMode = paymentMode;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { expenseNo: { contains: q, mode: "insensitive" } },
      { paidTo: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const afterId = decodeCursor(cursor);
  const rows = await prisma.expense.findMany({
    where,
    include: expenseInclude,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });

  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    data: page.map(toExpenseDTO),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage ? encodeCursor(page[page.length - 1]!.id) : null,
    },
  };
}

export async function getExpense(shopId: string, id: Id): Promise<ExpenseDTO | null> {
  const e = await prisma.expense.findFirst({ where: { id, shopId }, include: expenseInclude });
  return e ? toExpenseDTO(e) : null;
}

export interface ExpenseSummary {
  /** Paise. */
  total: number;
  count: number;
  /** Recoverable input tax across the range, in paise. */
  taxTotal: number;
  byCategory: { categoryId: Id; name: string; total: number; count: number }[];
  byPaymentMode: { mode: ExpensePaymentMode; total: number }[];
}

/**
 * The answer to "where did my month go" — one grouped pass per axis rather than
 * pulling every row into memory to add it up.
 */
export async function expenseSummary(
  shopId: string,
  range: { from?: string; to?: string } = {},
): Promise<ExpenseSummary> {
  const where: Prisma.ExpenseWhereInput = { shopId };
  if (range.from || range.to) {
    where.date = {};
    if (range.from) where.date.gte = new Date(range.from);
    if (range.to) where.date.lte = new Date(range.to);
  }

  const [grand, byCat, byMode, cats] = await Promise.all([
    prisma.expense.aggregate({
      where,
      _sum: { totalAmount: true, cgst: true, sgst: true, igst: true },
      _count: { _all: true },
    }),
    prisma.expense.groupBy({
      by: ["categoryId"],
      where,
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.expense.groupBy({ by: ["paymentMode"], where, _sum: { totalAmount: true } }),
    prisma.expenseCategory.findMany({ where: { shopId }, select: { id: true, name: true } }),
  ]);

  const nameOf = new Map(cats.map((c) => [c.id, c.name]));
  return {
    total: toPaise(grand._sum.totalAmount ?? 0),
    count: grand._count._all,
    taxTotal:
      toPaise(grand._sum.cgst ?? 0) + toPaise(grand._sum.sgst ?? 0) + toPaise(grand._sum.igst ?? 0),
    byCategory: byCat
      .map((r) => ({
        categoryId: r.categoryId,
        name: nameOf.get(r.categoryId) ?? "—",
        total: toPaise(r._sum.totalAmount ?? 0),
        count: r._count._all,
      }))
      .sort((a, b) => b.total - a.total),
    byPaymentMode: byMode
      .map((r) => ({
        mode: r.paymentMode as ExpensePaymentMode,
        total: toPaise(r._sum.totalAmount ?? 0),
      }))
      .sort((a, b) => b.total - a.total),
  };
}

export {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
  createExpenseCategorySchema,
  EXPENSE_PAYMENT_MODES,
  STARTER_EXPENSE_CATEGORIES,
} from "./schema";
export type {
  CreateExpenseInput,
  UpdateExpenseInput,
  ListExpensesQuery,
  CreateExpenseCategoryInput,
  ExpensePaymentMode,
} from "./schema";
