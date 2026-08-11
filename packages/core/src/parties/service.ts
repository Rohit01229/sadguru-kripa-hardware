// Parties (21d) — myBillBook's one directory of everyone the shop deals with.
//
// A shopkeeper does not think "customers screen" and "suppliers screen"; they think
// "who do I owe, and who owes me". This is that single list.
//
// IMPORTANT — this is a READ MODEL over the existing Customer and Supplier tables, not
// a merge of them. Merging would mean rewriting every foreign key in billing (Invoice,
// Order, LedgerEntry, Address, CustomerAccount, SalesDoc) and purchasing
// (GoodsReceipt, SupplierPayment, PurchaseOrder) — enormous risk to the parts of the
// app that handle money, in exchange for a screen. The two tables genuinely differ:
// only a customer can have a storefront login and a khata; only a supplier receives a
// purchase order. So the SCREEN is unified and the models stay as they are.
import Decimal from "decimal.js";
import { Prisma, prisma } from "../shared/db";
import { toPaise } from "../shared/money";
import type { Id } from "../shared/types";
import { listPartiesQuerySchema, type ListPartiesQuery, type PartyKind } from "./schema";

export interface PartyDTO {
  id: Id;
  kind: PartyKind;
  name: string;
  phone: string | null;
  gstin: string | null;
  /**
   * Paise, signed from the SHOP's point of view:
   *   +  they owe us (a customer's khata balance)
   *   −  we owe them (a supplier's unpaid purchases)
   * One column, so the list can be read top to bottom without switching mental models.
   */
  balance: number;
  /** Where this party's own screen lives — the two kinds keep their existing pages. */
  href: string;
  createdAt: string;
}

export interface PartyListResult {
  data: PartyDTO[];
  counts: { all: number; customers: number; suppliers: number };
  totals: { toCollect: number; toPay: number };
}

interface RawSupplierValue {
  supplierId: string;
  value: Prisma.Decimal | null;
}

/**
 * Every customer's khata balance in ONE query. `LedgerEntry.amount` is signed by
 * convention (+ debit / − credit), so the balance is a plain sum — the same figure
 * `outstanding()` returns for a single customer, without N round-trips for a list.
 */
async function customerBalances(shopId: string): Promise<Map<string, number>> {
  const rows = await prisma.ledgerEntry.groupBy({
    by: ["customerId"],
    where: { shopId },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.customerId, toPaise(r._sum.amount ?? new Decimal(0))]));
}

/**
 * Every supplier's payable in two queries: what has been received from them, minus
 * what has been paid.
 *
 * The goods value needs GrnLine joined to GoodsReceipt (the line has no supplier), and
 * Prisma's groupBy cannot join — hence raw SQL. Parameterised through the tagged
 * template, so `shopId` is bound, never interpolated.
 *
 * Note this is purchases-received minus payments, NOT an invoice-matched payable: the
 * shop may have been billed for goods not yet entered, or vice versa. It is the honest
 * figure available from what the app actually records.
 */
async function supplierBalances(shopId: string): Promise<Map<string, number>> {
  const [received, paid] = await Promise.all([
    prisma.$queryRaw<RawSupplierValue[]>`
      SELECT g."supplierId" AS "supplierId",
             SUM(l."baseQty" * l."costPerBaseUnit") AS "value"
      FROM "GrnLine" l
      JOIN "GoodsReceipt" g ON g."id" = l."grnId"
      WHERE l."shopId" = ${shopId} AND g."supplierId" IS NOT NULL
      GROUP BY g."supplierId"`,
    prisma.supplierPayment.groupBy({
      by: ["supplierId"],
      where: { shopId },
      _sum: { amount: true },
    }),
  ]);

  const owed = new Map<string, number>();
  for (const r of received) {
    if (r.supplierId) owed.set(r.supplierId, toPaise(r.value ?? new Decimal(0)));
  }
  for (const p of paid) {
    const prev = owed.get(p.supplierId) ?? 0;
    owed.set(p.supplierId, prev - toPaise(p._sum.amount ?? new Decimal(0)));
  }
  return owed;
}

/**
 * The unified directory. Both tables are read in full rather than paginated: merging
 * two independently-paginated sources into one alphabetical list cannot be done
 * correctly with cursors, and a hardware shop's party list is hundreds, not millions.
 * A hard cap keeps a runaway shop from loading everything into memory; when it is hit
 * the search box is the way through, and `truncated` says so rather than silently
 * showing a partial list.
 */
const PARTY_CAP = 2000;

export async function listParties(
  shopId: string,
  query: ListPartiesQuery = {},
  access: { customers: boolean; suppliers: boolean } = { customers: true, suppliers: true },
): Promise<PartyListResult & { truncated: boolean }> {
  const { kind, q, hasBalance } = listPartiesQuerySchema.parse(query);

  const wantCustomers = access.customers && kind !== "SUPPLIER";
  const wantSuppliers = access.suppliers && kind !== "CUSTOMER";

  const textFilter = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
          { gstin: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [customers, suppliers, custBal, suppBal, custTotal, suppTotal] = await Promise.all([
    wantCustomers
      ? prisma.customer.findMany({
          where: { shopId, ...textFilter },
          orderBy: { name: "asc" },
          take: PARTY_CAP,
          select: { id: true, name: true, phone: true, gstin: true, createdAt: true },
        })
      : Promise.resolve([]),
    wantSuppliers
      ? prisma.supplier.findMany({
          where: { shopId, ...textFilter },
          orderBy: { name: "asc" },
          take: PARTY_CAP,
          select: { id: true, name: true, phone: true, gstin: true, createdAt: true },
        })
      : Promise.resolve([]),
    access.customers ? customerBalances(shopId) : Promise.resolve(new Map<string, number>()),
    access.suppliers ? supplierBalances(shopId) : Promise.resolve(new Map<string, number>()),
    access.customers ? prisma.customer.count({ where: { shopId } }) : Promise.resolve(0),
    access.suppliers ? prisma.supplier.count({ where: { shopId } }) : Promise.resolve(0),
  ]);

  const rows: PartyDTO[] = [
    ...customers.map((c) => ({
      id: c.id,
      kind: "CUSTOMER" as const,
      name: c.name,
      phone: c.phone,
      gstin: c.gstin,
      balance: custBal.get(c.id) ?? 0,
      href: `/ledger/${c.id}`,
      createdAt: c.createdAt.toISOString(),
    })),
    ...suppliers.map((s) => ({
      id: s.id,
      kind: "SUPPLIER" as const,
      name: s.name,
      phone: s.phone,
      gstin: s.gstin,
      // Negated: a supplier payable is money going OUT, and the whole point of one
      // balance column is that its sign always means the same thing.
      balance: -(suppBal.get(s.id) ?? 0),
      // The supplier directory lives in the Stock section; `highlight` marks the row
      // and `#supplier-<id>` scrolls to it.
      href: `/stock/suppliers?highlight=${s.id}#supplier-${s.id}`,
      createdAt: s.createdAt.toISOString(),
    })),
  ];

  const filtered = hasBalance ? rows.filter((r) => r.balance !== 0) : rows;
  // Biggest debts first, then alphabetical: this is a call sheet, not a directory.
  filtered.sort((a, b) => {
    const byBalance = Math.abs(b.balance) - Math.abs(a.balance);
    return byBalance !== 0 ? byBalance : a.name.localeCompare(b.name);
  });

  let toCollect = 0;
  let toPay = 0;
  for (const r of rows) {
    if (r.balance > 0) toCollect += r.balance;
    else if (r.balance < 0) toPay += -r.balance;
  }

  return {
    data: filtered,
    counts: { all: custTotal + suppTotal, customers: custTotal, suppliers: suppTotal },
    totals: { toCollect, toPay },
    truncated: customers.length === PARTY_CAP || suppliers.length === PARTY_CAP,
  };
}

export * from "./schema";
