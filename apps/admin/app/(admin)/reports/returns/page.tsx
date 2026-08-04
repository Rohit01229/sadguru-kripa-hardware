import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { salesReturns, requirePermission, Forbidden } from "@hardware/core";
import {
  PageHeader,
  StatCard,
  Button,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { ReportsNav, Forbid } from "../nav";
import { RangeFilterBar } from "../RangeFilterBar";

// Sales returns / credit notes (19 §11; reports.read). Every credit note raised over
// [from,to] with its reason and refund route — the audit trail for returned goods.
export default async function SalesReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
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
  const report = await salesReturns(shopId, { from: sp.from, to: sp.to });
  const t = await getTranslations("reports");
  const hasFilters = Boolean(sp.from || sp.to);

  return (
    <div className="space-y-6">
      <ReportsNav active="returns" />
      <PageHeader title={t("returns.title")} description={t("returns.description")} />

      <RangeFilterBar
        action="/reports/returns"
        from={report.from}
        to={report.to}
        hasFilters={hasFilters}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t("returns.statCount")} value={report.count} />
        <StatCard label={t("returns.statTax")} value={formatMoney(report.totalTax)} />
        <StatCard label={t("returns.statTotal")} value={formatMoney(report.totalGrand)} />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState
          title={t("returns.emptyTitle")}
          description={t("returns.emptyDescription")}
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link href="/reports/returns">{t("sales.clearFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("returns.colNo")}</TableHead>
                <TableHead>{t("returns.colDate")}</TableHead>
                <TableHead>{t("returns.colInvoice")}</TableHead>
                <TableHead>{t("returns.colParty")}</TableHead>
                <TableHead>{t("returns.colReason")}</TableHead>
                <TableHead>{t("returns.colRefund")}</TableHead>
                <TableHead numeric>{t("returns.colTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.creditNoteNo}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.date)}</TableCell>
                  <TableCell>{r.invoiceNo}</TableCell>
                  <TableCell>{r.customerName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.reason ?? "—"}</TableCell>
                  <TableCell>
                    {r.refundMode ? <Badge variant="outline">{r.refundMode}</Badge> : "—"}
                  </TableCell>
                  <TableCell numeric className="font-medium">
                    {formatMoney(r.grandTotal)}
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
