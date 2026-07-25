// Dashboard (S7; 14-impl-plan Chunk 11). A READ-ONLY cross-module roll-up the admin
// home surfaces: today's pakka sales, low-stock count + items, total dues
// (receivables), and top-selling items over a recent window. It reuses the reports
// and inventory read services rather than re-deriving queries (03 §3: reports read
// across modules, mutate nothing). Permission (reports.read) is enforced at transport.
import Decimal from "decimal.js";
import { prisma } from "../shared/db";
import { toPaise } from "../shared/money";
import { dayEnd } from "../reports/service";
import { lowStock, type StockRowDTO } from "../inventory/service";

export interface DashboardTopItem {
  productId: string;
  name: string;
  sku: string;
  qty: string; // base qty sold in the window
  total: number; // paise
}

export interface DashboardDTO {
  date: string;
  today: {
    invoiceCount: number;
    grandTotal: number; // paise
    byPaymentMode: { mode: string; amount: number; count: number }[];
  };
  lowStock: {
    count: number;
    items: StockRowDTO[]; // first page (capped)
  };
  dues: {
    customerCount: number; // customers with a positive outstanding
    totalOutstanding: number; // paise (sum of positive balances)
  };
  topItems: DashboardTopItem[];
}

/**
 * Build the admin dashboard view (reports.read at transport). Today's sales come
 from the day-end roll-up (pakka only, kacha excluded). Low-stock reuses the
 * inventory alert source. Dues sums every customer's POSITIVE net ledger balance.
 * Top items aggregate ACTIVE invoice lines over the last `windowDays` (default 30).
 */
export async function getDashboard(now: Date = new Date(), windowDays = 30): Promise<DashboardDTO> {
  const today = now.toISOString().slice(0, 10);
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // These four roll-up reads are mutually independent — run them in parallel instead
  // of stacking sequential cross-region round-trips. Only the top-items product
  // lookup (below) depends on lineGroups, so it stays after this batch.
  //  1. Today's sales — reuse the day-end report (pakka only).
  //  2. Low stock — reuse the inventory alert source (capped page).
  //  3. Dues — signed ledger grouped by customer; positives are receivables.
  //  4. Top items over the window — ACTIVE invoice lines aggregated by product.
  const [de, low, grouped, lineGroups] = await Promise.all([
    dayEnd({ date: today }),
    lowStock(50),
    prisma.ledgerEntry.groupBy({
      by: ["customerId"],
      _sum: { amount: true },
    }),
    prisma.invoiceLine.groupBy({
      by: ["productId"],
      where: { invoice: { status: "ACTIVE", date: { gte: windowStart } } },
      _sum: { baseQty: true, taxableValue: true, cgst: true, sgst: true, igst: true },
      _count: { _all: true },
    }),
  ]);

  // Dues — a positive net (debit − credit) is a receivable.
  let duesTotal = new Decimal(0);
  let duesCustomers = 0;
  for (const g of grouped) {
    const net = g._sum.amount ?? new Decimal(0);
    if (new Decimal(net).gt(0)) {
      duesTotal = duesTotal.plus(net);
      duesCustomers += 1;
    }
  }
  // Rank by line total (taxable + tax) desc, take top 8.
  const ranked = lineGroups
    .map((g) => {
      const total = new Decimal(g._sum.taxableValue ?? 0)
        .plus(g._sum.cgst ?? 0)
        .plus(g._sum.sgst ?? 0)
        .plus(g._sum.igst ?? 0);
      return { productId: g.productId, qty: new Decimal(g._sum.baseQty ?? 0), total };
    })
    .sort((a, b) => b.total.comparedTo(a.total))
    .slice(0, 8);

  const products = await prisma.product.findMany({
    where: { id: { in: ranked.map((r) => r.productId) } },
    select: { id: true, name: true, sku: true },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));
  const topItems: DashboardTopItem[] = ranked.map((r) => {
    const p = pmap.get(r.productId);
    return {
      productId: r.productId,
      name: p?.name ?? r.productId,
      sku: p?.sku ?? "",
      qty: r.qty.toFixed(3),
      total: toPaise(r.total),
    };
  });

  return {
    date: today,
    today: {
      invoiceCount: de.invoiceCount,
      grandTotal: de.grandTotal,
      byPaymentMode: de.byPaymentMode,
    },
    lowStock: { count: low.length, items: low },
    dues: { customerCount: duesCustomers, totalOutstanding: toPaise(duesTotal) },
    topItems,
  };
}
