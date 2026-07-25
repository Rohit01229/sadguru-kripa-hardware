import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { dayEnd, requirePermission, Forbidden } from "@hardware/core";
import {
  PageHeader,
  StatCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  formatMoney,
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { ReportsNav, Forbid } from "./nav";
import { DayEndFilter } from "./DayEndFilter";

// Day-end summary report (S7; reports.read). Pakka only — kacha is excluded by design
// (no Invoice rows; 03 §6). Cancelled invoices are counted but not summed. The date is
// a ?date=YYYY-MM-DD query (defaults to today). Read-only.
export default async function DayEndReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
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
  const summary = await dayEnd({ date: sp.date });
  const t = await getTranslations("reports");

  return (
    <div className="space-y-6">
      <ReportsNav active="day-end" />

      <PageHeader
        title={t("dayEnd.title")}
        description={t("dayEnd.description", { date: summary.date })}
        actions={<DayEndFilter date={summary.date} />}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label={t("dayEnd.statInvoices")} value={summary.invoiceCount} />
        <StatCard label={t("dayEnd.statCancelled")} value={summary.cancelledCount} />
        <StatCard label={t("dayEnd.statTaxable")} value={formatMoney(summary.taxableTotal)} />
        <StatCard label={t("dayEnd.statGrandTotal")} value={formatMoney(summary.grandTotal)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("dayEnd.taxBreakup")}</h2>
        <div className="max-w-md overflow-x-auto rounded-lg border">
          <Table>
            <TableBody>
              <Row label={t("dayEnd.cgst")} value={formatMoney(summary.cgstTotal)} />
              <Row label={t("dayEnd.sgst")} value={formatMoney(summary.sgstTotal)} />
              <Row label={t("dayEnd.igst")} value={formatMoney(summary.igstTotal)} />
              <Row label={t("dayEnd.roundOff")} value={formatMoney(summary.roundOffTotal)} />
              <Row
                label={t("dayEnd.creditNotes")}
                value={`${summary.creditNoteCount} · ${formatMoney(summary.creditNoteTotal)}`}
              />
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("dayEnd.byPaymentMode")}</h2>
        {summary.byPaymentMode.length === 0 ? (
          <EmptyState
            title={t("dayEnd.noPaymentsTitle")}
            description={t("dayEnd.noPaymentsDescription")}
          />
        ) : (
          <div className="max-w-md overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("dayEnd.colMode")}</TableHead>
                  <TableHead numeric>{t("dayEnd.colCount")}</TableHead>
                  <TableHead numeric>{t("dayEnd.colAmount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byPaymentMode.map((m) => (
                  <TableRow key={m.mode}>
                    <TableCell>{m.mode}</TableCell>
                    <TableCell numeric>{m.count}</TableCell>
                    <TableCell numeric>{formatMoney(m.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell numeric>{value}</TableCell>
    </TableRow>
  );
}
