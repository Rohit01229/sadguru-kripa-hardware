import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { gstr1, requirePermission, Forbidden } from "@hardware/core";
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
import { Gstr1PeriodFilter } from "./Gstr1PeriodFilter";

// GSTR-1 export (S7; reports.export). B2B / B2C / credit-note sections + HSN summary
// for a ?period=YYYY-MM (defaults to the current month). Figures reconcile to the
// period's ACTIVE invoices; kacha is absent; an empty period renders empty sections
// (never fabricated). The CSV download hits the same core service via the route.
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function Gstr1Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "reports.export");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="reports.export" />;
    throw e;
  }

  const sp = await searchParams;
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : currentPeriod();
  const report = await gstr1({ period });
  const t = await getTranslations("reports");

  return (
    <div className="space-y-6">
      <ReportsNav active="gstr1" />

      <PageHeader
        title={t("gstr1.title", { period: report.period })}
        description={t("gstr1.description")}
        actions={
          // method=get → ?period= search param → core gstr1 query. The CSV link hits
          // the same core service via the route. Stacks full-width on mobile; inline ≥sm.
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end">
            <Gstr1PeriodFilter period={report.period} />
            {/* Raw <a> on purpose: this is a CSV file download, not an internal route. */}
            <Button asChild variant="outline" className="h-11 w-full sm:h-9 sm:w-auto">
              <a href={`/api/reports/gstr1?period=${report.period}&format=csv`}>{t("gstr1.downloadCsv")}</a>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t("gstr1.statB2bTaxable")} value={formatMoney(report.totals.b2bTaxable)} />
        <StatCard label={t("gstr1.statB2cTaxable")} value={formatMoney(report.totals.b2cTaxable)} />
        <StatCard label={t("gstr1.statCnTaxable")} value={formatMoney(report.totals.cnTaxable)} />
        <StatCard label={t("gstr1.statCgst")} value={formatMoney(report.totals.cgst)} />
        <StatCard label={t("gstr1.statSgst")} value={formatMoney(report.totals.sgst)} />
        <StatCard label={t("gstr1.statIgst")} value={formatMoney(report.totals.igst)} />
      </div>

      <Section title={t("gstr1.sectionB2b", { count: report.b2b.length })}>
        <InvoiceTable rows={report.b2b} showGstin />
      </Section>
      <Section title={t("gstr1.sectionB2c", { count: report.b2c.length })}>
        <InvoiceTable rows={report.b2c} />
      </Section>
      <Section title={t("gstr1.sectionCreditNotes", { count: report.creditNotes.length })}>
        {report.creditNotes.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[32rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("gstr1.colCnNo")}</TableHead>
                  <TableHead>{t("gstr1.colDate")}</TableHead>
                  <TableHead>{t("gstr1.colOrigInvoice")}</TableHead>
                  <TableHead numeric>{t("gstr1.colTaxable")}</TableHead>
                  <TableHead numeric>{t("gstr1.colValue")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.creditNotes.map((r) => (
                  <TableRow key={r.creditNoteNo}>
                    <TableCell className="font-mono text-xs">{r.creditNoteNo}</TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell className="font-mono text-xs">{r.originalInvoiceNo}</TableCell>
                    <TableCell numeric>{formatMoney(r.taxableValue)}</TableCell>
                    <TableCell numeric>{formatMoney(r.noteValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
      <Section title={t("gstr1.sectionHsn", { count: report.hsn.length })}>
        {report.hsn.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("gstr1.colHsn")}</TableHead>
                  <TableHead>{t("gstr1.colUqc")}</TableHead>
                  <TableHead numeric>{t("gstr1.colQty")}</TableHead>
                  <TableHead numeric>{t("gstr1.colTaxable")}</TableHead>
                  <TableHead numeric>{t("gstr1.colCgst")}</TableHead>
                  <TableHead numeric>{t("gstr1.colSgst")}</TableHead>
                  <TableHead numeric>{t("gstr1.colIgst")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.hsn.map((r) => (
                  <TableRow key={`${r.hsnCode}-${r.uqc}`}>
                    <TableCell className="font-mono text-xs">{r.hsnCode}</TableCell>
                    <TableCell>{r.uqc}</TableCell>
                    <TableCell numeric>{formatQty(r.totalQty)}</TableCell>
                    <TableCell numeric>{formatMoney(r.taxableValue)}</TableCell>
                    <TableCell numeric>{formatMoney(r.cgst)}</TableCell>
                    <TableCell numeric>{formatMoney(r.sgst)}</TableCell>
                    <TableCell numeric>{formatMoney(r.igst)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}

async function InvoiceTable({
  rows,
  showGstin,
}: {
  rows: { invoiceNo: string; date: string; gstin: string | null; customerName: string | null; placeOfSupplyState: string; taxableValue: number; cgst: number; sgst: number; igst: number; invoiceValue: number }[];
  showGstin?: boolean;
}) {
  if (rows.length === 0) return <Empty />;
  const t = await getTranslations("reports");
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[52rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("gstr1.colInvoice")}</TableHead>
            <TableHead>{t("gstr1.colDate")}</TableHead>
            {showGstin && <TableHead>{t("gstr1.colGstin")}</TableHead>}
            <TableHead>{t("gstr1.colPos")}</TableHead>
            <TableHead numeric>{t("gstr1.colTaxable")}</TableHead>
            <TableHead numeric>{t("gstr1.colCgst")}</TableHead>
            <TableHead numeric>{t("gstr1.colSgst")}</TableHead>
            <TableHead numeric>{t("gstr1.colIgst")}</TableHead>
            <TableHead numeric>{t("gstr1.colValue")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.invoiceNo}>
              <TableCell className="font-mono text-xs">{r.invoiceNo}</TableCell>
              <TableCell>{r.date}</TableCell>
              {showGstin && <TableCell className="font-mono text-xs text-muted-foreground">{r.gstin ?? "—"}</TableCell>}
              <TableCell>{r.placeOfSupplyState}</TableCell>
              <TableCell numeric>{formatMoney(r.taxableValue)}</TableCell>
              <TableCell numeric>{formatMoney(r.cgst)}</TableCell>
              <TableCell numeric>{formatMoney(r.sgst)}</TableCell>
              <TableCell numeric>{formatMoney(r.igst)}</TableCell>
              <TableCell numeric className="font-medium">{formatMoney(r.invoiceValue)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function Empty() {
  const t = await getTranslations("reports");
  return <EmptyState title={t("gstr1.emptyRowsTitle")} description={t("gstr1.emptyRowsDescription")} />;
}
