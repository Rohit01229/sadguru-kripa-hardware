import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDashboard, requirePermission, can, Forbidden } from "@hardware/core";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  EmptyState,
  ForbiddenState,
  Button,
  Skeleton,
  formatMoney,
  formatQty,
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";

// Admin dashboard (S7): a cross-module roll-up — today's pakka sales, low stock, dues,
// top items (03 §3: reports read across modules). Guarded with products.read; the
// sales/dues roll-up additionally needs reports.read and degrades gracefully without it.
// UI hiding is cosmetic; each linked screen re-checks its own permission server-side.
// The app shell (sidebar + topbar user menu / sign-out) wraps this page via
// (admin)/layout.tsx, so this page renders content only.

export default async function DashboardPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  try {
    requirePermission(session, "products.read");
  } catch (e) {
    if (e instanceof Forbidden) {
      return (
        <div className="space-y-6">
          <PageHeader title={tc("nav.dashboard")} />
          <ForbiddenState perm="products.read" />
        </div>
      );
    }
    throw e;
  }

  const showRollup = can(session, "reports.read");

  return (
    <div className="space-y-6">
      <PageHeader
        title={tc("nav.dashboard")}
        description={t("description")}
        actions={
          can(session, "bill.kacha.create") || can(session, "bill.pakka.create") ? (
            <Button asChild>
              <Link href="/billing">{t("newInvoice")}</Link>
            </Button>
          ) : undefined
        }
      />

      {/* The roll-up is the slow region (cross-module reads). Stream it under Suspense so
          the header + "New invoice" action paint immediately; loading.tsx only covers the
          initial route transition. */}
      {showRollup ? (
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardRollup />
        </Suspense>
      ) : (
        <EmptyState
          title={t("rollupUnavailable.title")}
          description={t.rich("rollupUnavailable.description", {
            code: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        />
      )}
    </div>
  );
}

/** The cross-module roll-up (today's sales, low stock, dues, top items). Slow region. */
async function DashboardRollup() {
  const dash = await getDashboard();
  const t = await getTranslations("dashboard");
  return (
    <>
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label={t("stats.todaysInvoices")}
              value={String(dash.today.invoiceCount)}
              sub={t("stats.todaysInvoicesSub")}
            />
            <StatCard label={t("stats.todaysSales")} value={formatMoney(dash.today.grandTotal)} />
            <StatCard
              label={t("stats.lowStockItems")}
              value={String(dash.lowStock.count)}
              sub={t("stats.lowStockItemsSub")}
              href="/stock?lowOnly=true"
              linkComponent={Link}
              tone={dash.lowStock.count > 0 ? "warning" : "default"}
            />
            <StatCard
              label={t("stats.receivables")}
              value={formatMoney(dash.dues.totalOutstanding)}
              sub={t("stats.customers", { count: dash.dues.customerCount })}
              href="/ledger"
              linkComponent={Link}
              tone={dash.dues.totalOutstanding > 0 ? "warning" : "default"}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">{t("topItems.title")}</CardTitle>
                <Link href="/reports/sales" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  {t("topItems.salesReport")}
                </Link>
              </CardHeader>
              <CardContent>
                {dash.topItems.length === 0 ? (
                  <EmptyState
                    className="border-0 p-6"
                    title={t("topItems.emptyTitle")}
                    description={t("topItems.emptyDescription")}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("topItems.colItem")}</TableHead>
                          <TableHead numeric>{t("topItems.colQty")}</TableHead>
                          <TableHead numeric>{t("topItems.colSales")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dash.topItems.map((t) => (
                          <TableRow key={t.productId}>
                            <TableCell>
                              <Link
                                href={`/catalog/${t.productId}`}
                                className="font-medium hover:underline"
                              >
                                {t.name}
                              </Link>
                            </TableCell>
                            <TableCell numeric>{formatQty(t.qty)}</TableCell>
                            <TableCell numeric>{formatMoney(t.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">{t("lowStock.title")}</CardTitle>
                <Link href="/stock?lowOnly=true" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  {t("lowStock.viewAll")}
                </Link>
              </CardHeader>
              <CardContent>
                {dash.lowStock.items.length === 0 ? (
                  <EmptyState
                    className="border-0 p-6"
                    title={t("lowStock.emptyTitle")}
                    description={t("lowStock.emptyDescription")}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("lowStock.colItem")}</TableHead>
                          <TableHead>{t("lowStock.colStatus")}</TableHead>
                          <TableHead numeric>{t("lowStock.colOnHand")}</TableHead>
                          <TableHead numeric>{t("lowStock.colReorder")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dash.lowStock.items.slice(0, 10).map((s) => {
                          const outOfStock = Number(s.available) <= 0;
                          return (
                            <TableRow key={s.productId}>
                              <TableCell>
                                <Link
                                  href={`/catalog/${s.productId}`}
                                  className="font-medium hover:underline"
                                >
                                  {s.name}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge variant={outOfStock ? "destructive" : "warning"}>
                                  {outOfStock ? t("lowStock.statusOutOfStock") : t("lowStock.statusLow")}
                                </Badge>
                              </TableCell>
                              <TableCell numeric>{formatQty(s.onHand, s.baseUnitCode)}</TableCell>
                              <TableCell numeric className="text-muted-foreground">
                                {s.reorderLevel ? formatQty(s.reorderLevel) : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
    </>
  );
}

/** Layout-matched placeholder shown while the roll-up streams in. */
function DashboardSkeleton() {
  return (
    <>
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-2 h-3 w-16" />
          </Card>
        ))}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((__, r) => (
                <Skeleton key={r} className="h-6 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
