import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { receivables, requirePermission, Forbidden } from "@hardware/core";
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
  Badge,
  formatMoney,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { ReportsNav, Forbid } from "../nav";

// Receivables / party outstanding (19 §11; reports.read + ledger.read). Who owes the
// shop money and how old it is — the report a khata-heavy hardware shop opens daily.
// Ordered biggest-first: it is a call sheet, not a directory.
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; all?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "reports.read");
    // The rows are ledger balances, so the ledger gate applies too.
    requirePermission(session, "ledger.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="reports.read + ledger.read" />;
    throw e;
  }

  const sp = await searchParams;
  const showAll = sp.all === "1";
  const shopId = await requireShopId();
  const report = await receivables(shopId, { asOf: sp.asOf, dueOnly: !showAll });
  const t = await getTranslations("reports");

  return (
    <div className="space-y-6">
      <ReportsNav active="receivables" />
      <PageHeader
        title={t("receivables.title")}
        description={t("receivables.description", { asOf: report.asOf })}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label={t("receivables.statTotal")} value={formatMoney(report.totalOutstanding)} />
        <StatCard label={t("receivables.stat0to30")} value={formatMoney(report.total0to30)} />
        <StatCard label={t("receivables.stat31to60")} value={formatMoney(report.total31to60)} />
        <StatCard label={t("receivables.stat60plus")} value={formatMoney(report.total60plus)} />
      </div>

      <p className="text-xs text-muted-foreground">
        <Link href={showAll ? "/reports/receivables" : "/reports/receivables?all=1"} className="underline">
          {showAll ? t("receivables.showDueOnly") : t("receivables.showAll")}
        </Link>
      </p>

      {report.rows.length === 0 ? (
        <EmptyState title={t("receivables.emptyTitle")} description={t("receivables.emptyDescription")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[42rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("receivables.colParty")}</TableHead>
                <TableHead>{t("receivables.colPhone")}</TableHead>
                <TableHead numeric>{t("receivables.col0to30")}</TableHead>
                <TableHead numeric>{t("receivables.col31to60")}</TableHead>
                <TableHead numeric>{t("receivables.col60plus")}</TableHead>
                <TableHead numeric>{t("receivables.colOutstanding")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.customerId}>
                  <TableCell>
                    <Link href={`/ledger/${r.customerId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.phone ?? "—"}</TableCell>
                  <TableCell numeric>{formatMoney(r.bucket0to30)}</TableCell>
                  <TableCell numeric>{formatMoney(r.bucket31to60)}</TableCell>
                  <TableCell numeric>
                    {/* Anything past 60 days is the collection problem — flag it. */}
                    {r.bucket60plus > 0 ? (
                      <Badge variant="destructive">{formatMoney(r.bucket60plus)}</Badge>
                    ) : (
                      formatMoney(0)
                    )}
                  </TableCell>
                  <TableCell numeric className="font-medium">
                    {formatMoney(r.outstanding)}
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
