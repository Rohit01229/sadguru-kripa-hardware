import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listExpenses,
  expenseSummary,
  listExpenseCategories,
  requirePermission,
  Forbidden,
  can,
} from "@hardware/core";
import {
  PageHeader,
  Button,
  Card,
  CardContent,
  Badge,
  EmptyState,
  ForbiddenState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../lib/session";
import { RangeFilterBar } from "../reports/RangeFilterBar";
import { DeleteExpenseButton } from "./DeleteExpenseButton";

// Expenses register (21b) — myBillBook's Expenses screen. Defaults to the current
// month, because "what have I spent this month" is the question being asked; a filter
// bar widens it. The category breakdown sits above the list, since the total per head
// is the answer and the individual rows are the evidence.

/** First and last day of the month containing `now`, as yyyy-mm-dd. */
function currentMonth(now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; categoryId?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "expenses.read");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="expenses.read" />;
    throw e;
  }

  const shopId = await requireShopId();
  const sp = await searchParams;
  const month = currentMonth();
  const from = sp.from || month.from;
  const to = sp.to || month.to;
  // The `to` bound is a date with no time, so a same-day expense recorded at 14:00
  // would fall outside it. Push it to the end of that day.
  const toInclusive = `${to}T23:59:59.999Z`;

  const [page, summary, categories] = await Promise.all([
    listExpenses(shopId, { from, to: toInclusive, categoryId: sp.categoryId, limit: 200 }),
    expenseSummary(shopId, { from, to: toInclusive }),
    listExpenseCategories(shopId),
  ]);
  const mayWrite = can(session, "expenses.write");
  const filtered = categories.find((c) => c.id === sp.categoryId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Money going out that is not stock — rent, wages, freight, electricity, tea."
        actions={
          mayWrite ? (
            <Button asChild>
              <Link href="/expenses/new">Add expense</Link>
            </Button>
          ) : undefined
        }
      />

      <RangeFilterBar action="/expenses" from={from} to={to} hasFilters={Boolean(sp.from || sp.to)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Spent in this period
            </div>
            <div className="text-2xl font-semibold tabular-nums">{formatMoney(summary.total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Entries</div>
            <div className="text-2xl font-semibold tabular-nums">{summary.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">GST on these</div>
            <div className="text-2xl font-semibold tabular-nums">{formatMoney(summary.taxTotal)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Input tax, where a GST bill was recorded.
            </div>
          </CardContent>
        </Card>
      </div>

      {summary.byCategory.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Where it went</h2>
              {filtered && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/expenses?from=${from}&to=${to}`}>Clear &ldquo;{filtered.name}&rdquo;</Link>
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {summary.byCategory.map((c) => {
                const pct = summary.total > 0 ? Math.round((c.total / summary.total) * 100) : 0;
                return (
                  <Link
                    key={c.categoryId}
                    href={`/expenses?from=${from}&to=${to}&categoryId=${c.categoryId}`}
                    className="block rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(c.total)}{" "}
                        <span className="text-muted-foreground">({pct}%)</span>
                      </span>
                    </div>
                    {/* A bar, not a chart library: one div is enough to rank a dozen heads. */}
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {page.data.length === 0 ? (
        <EmptyState
          title="Nothing recorded for this period"
          description="Add rent, electricity, wages or freight and they will be totalled here by category."
          action={
            mayWrite ? (
              <Button asChild>
                <Link href="/expenses/new">Add expense</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[46rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Paid to</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead numeric>GST</TableHead>
                    <TableHead numeric>Amount</TableHead>
                    {mayWrite && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.data.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div>{formatDate(e.date)}</div>
                        <div className="font-mono text-xs text-muted-foreground">{e.expenseNo}</div>
                      </TableCell>
                      <TableCell>{e.categoryName}</TableCell>
                      <TableCell className="text-muted-foreground">{e.paidTo ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{e.paymentMode}</Badge>
                      </TableCell>
                      <TableCell numeric className="text-muted-foreground">
                        {e.taxAmount > 0 ? formatMoney(e.taxAmount) : "—"}
                      </TableCell>
                      <TableCell numeric className="font-medium">
                        {formatMoney(e.totalAmount)}
                      </TableCell>
                      {mayWrite && (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button asChild size="sm" variant="ghost">
                              <Link href={`/expenses/${e.id}/edit`}>Edit</Link>
                            </Button>
                            <DeleteExpenseButton id={e.id} label={e.expenseNo} />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
