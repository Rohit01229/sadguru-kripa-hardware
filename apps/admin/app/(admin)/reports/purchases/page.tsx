import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { purchaseReport, requirePermission, Forbidden, type PurchaseReportQuery } from "@hardware/core";
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
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { ReportsNav, Forbid } from "../nav";
import { RangeFilterBar } from "../RangeFilterBar";

// Purchase report (19 §11; reports.read). What the shop bought over [from,to], from the
// goods-receipt trail, grouped by day / supplier / item.
type GroupBy = NonNullable<PurchaseReportQuery["groupBy"]>;

export default async function PurchaseReportPage({
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
  const shopId = await requireShopId();
  const report = await purchaseReport(shopId, {
    from: sp.from,
    to: sp.to,
    groupBy: sp.groupBy as GroupBy | undefined,
  });
  const t = await getTranslations("reports");
  const hasFilters = Boolean(sp.from || sp.to || (sp.groupBy && sp.groupBy !== "day"));
  const showQty = report.groupBy === "item";

  const groupLabel =
    report.groupBy === "day"
      ? t("purchases.groupDay")
      : report.groupBy === "supplier"
        ? t("purchases.groupSupplier")
        : t("purchases.groupItem");

  return (
    <div className="space-y-6">
      <ReportsNav active="purchases" />
      <PageHeader title={t("purchases.title")} description={t("purchases.description")} />

      <RangeFilterBar
        action="/reports/purchases"
        from={report.from}
        to={report.to}
        groupBy={report.groupBy}
        groupOptions={[
          { value: "day", label: t("purchases.groupDay") },
          { value: "supplier", label: t("purchases.groupSupplier") },
          { value: "item", label: t("purchases.groupItem") },
        ]}
        hasFilters={hasFilters}
      />

      <div className="grid grid-cols-2 gap-4">
        <StatCard label={t("purchases.statGrns")} value={report.grnCount} />
        <StatCard label={t("purchases.statValue")} value={formatMoney(report.totalValue)} />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState
          title={t("purchases.emptyTitle")}
          description={t("purchases.emptyDescription")}
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link href="/reports/purchases">{t("sales.clearFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{groupLabel}</TableHead>
                {showQty && <TableHead numeric>{t("purchases.colQty")}</TableHead>}
                <TableHead numeric>{t("purchases.colCount")}</TableHead>
                <TableHead numeric>{t("purchases.colValue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.label}</TableCell>
                  {showQty && <TableCell numeric>{r.qty ?? "—"}</TableCell>}
                  <TableCell numeric>{r.count}</TableCell>
                  <TableCell numeric className="font-medium">
                    {formatMoney(r.value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
