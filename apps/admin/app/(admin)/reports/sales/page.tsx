import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { salesReport, requirePermission, Forbidden, type SalesReportQuery } from "@hardware/core";
import {
  PageHeader,
  StatCard,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  formatMoney,
  formatQty,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { ReportsNav, Forbid } from "../nav";
import { SalesFilterBar } from "./SalesFilterBar";

// Sales report (S7; reports.read). ACTIVE pakka sales over [from,to], grouped by
// day / item / category / payment-mode. Kacha excluded (no rows). Read-only.
type GroupBy = NonNullable<SalesReportQuery["groupBy"]>;

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; groupBy?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "reports.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="reports.read" />;
    throw e;
  }

  const sp = await searchParams;
  const report = await salesReport({ from: sp.from, to: sp.to, groupBy: sp.groupBy as GroupBy | undefined });
  const t = await getTranslations("reports");
  const hasFilters = Boolean(sp.from || sp.to || (sp.groupBy && sp.groupBy !== "day"));
  const showQty = report.groupBy === "item" || report.groupBy === "category";
  const groupLabel =
    report.groupBy === "day"
      ? t("sales.groupDay")
      : report.groupBy === "paymentMode"
        ? t("sales.groupMode")
        : report.groupBy === "item"
          ? t("sales.groupItem")
          : t("sales.groupCategory");

  return (
    <div className="space-y-6">
      <ReportsNav active="sales" />

      <PageHeader title={t("sales.title")} description={t("sales.description")} />

      {/* Server-side filter bar. Extracted to a client component that intercepts submit
          for no-reload navigation; method="get" stays as the no-JS fallback. */}
      <SalesFilterBar
        from={report.from}
        to={report.to}
        groupBy={report.groupBy}
        hasFilters={hasFilters}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label={t("sales.statInvoices")} value={report.totals.invoiceCount} />
        <StatCard label={t("sales.statTaxable")} value={formatMoney(report.totals.taxable)} />
        <StatCard label={t("sales.statTax")} value={formatMoney(report.totals.tax)} />
        <StatCard label={t("sales.statTotal")} value={formatMoney(report.totals.total)} />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState
          title={t("sales.emptyTitle")}
          description={t("sales.emptyDescription")}
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link href="/reports/sales">{t("sales.clearFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{groupLabel}</TableHead>
                {showQty && <TableHead numeric>{t("sales.colQty")}</TableHead>}
                <TableHead numeric>{t("sales.colCount")}</TableHead>
                <TableHead numeric>{t("sales.colTaxable")}</TableHead>
                <TableHead numeric>{t("sales.colTax")}</TableHead>
                <TableHead numeric>{t("sales.colTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.label}</TableCell>
                  {showQty && <TableCell numeric>{r.qty == null ? "—" : formatQty(r.qty)}</TableCell>}
                  <TableCell numeric>{r.count}</TableCell>
                  <TableCell numeric>{formatMoney(r.taxable)}</TableCell>
                  <TableCell numeric>{formatMoney(r.tax)}</TableCell>
                  <TableCell numeric className="font-medium">{formatMoney(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
