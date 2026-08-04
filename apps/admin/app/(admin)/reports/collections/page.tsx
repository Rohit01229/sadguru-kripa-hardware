import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { collections, requirePermission, Forbidden, type CollectionsQuery } from "@hardware/core";
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

// Collections / payments received (19 §11; reports.read). Day-end covers one day; this
// covers a range, which is what reconciling a week against the cash box needs.
type GroupBy = NonNullable<CollectionsQuery["groupBy"]>;

export default async function CollectionsPage({
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
  const report = await collections(shopId, {
    from: sp.from,
    to: sp.to,
    groupBy: sp.groupBy as GroupBy | undefined,
  });
  const t = await getTranslations("reports");
  const hasFilters = Boolean(sp.from || sp.to || (sp.groupBy && sp.groupBy !== "day"));

  return (
    <div className="space-y-6">
      <ReportsNav active="collections" />
      <PageHeader title={t("collections.title")} description={t("collections.description")} />

      <RangeFilterBar
        action="/reports/collections"
        from={report.from}
        to={report.to}
        groupBy={report.groupBy}
        groupOptions={[
          { value: "day", label: t("collections.groupDay") },
          { value: "mode", label: t("collections.groupMode") },
        ]}
        hasFilters={hasFilters}
      />

      <div className="grid grid-cols-2 gap-4">
        <StatCard label={t("collections.statCount")} value={report.count} />
        <StatCard label={t("collections.statTotal")} value={formatMoney(report.total)} />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState
          title={t("collections.emptyTitle")}
          description={t("collections.emptyDescription")}
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link href="/reports/collections">{t("sales.clearFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[28rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>
                  {report.groupBy === "day" ? t("collections.groupDay") : t("collections.groupMode")}
                </TableHead>
                <TableHead numeric>{t("collections.colCount")}</TableHead>
                <TableHead numeric>{t("collections.colAmount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell numeric>{r.count}</TableCell>
                  <TableCell numeric className="font-medium">
                    {formatMoney(r.amount)}
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
