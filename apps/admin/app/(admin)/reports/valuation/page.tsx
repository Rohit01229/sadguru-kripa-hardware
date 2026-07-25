import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { stockValuation, requirePermission, Forbidden } from "@hardware/core";
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
  formatQty,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { ReportsNav, Forbid } from "../nav";
import { ValuationFilter } from "./ValuationFilter";

// Stock valuation report (S7; reports.read). value = onHand(base) × costPerBaseUnit
// across the active catalog. Read-only.
export default async function ValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ inStockOnly?: string }>;
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
  const inStockOnly = sp.inStockOnly === "true";
  const report = await stockValuation({ inStockOnly });
  const t = await getTranslations("reports");

  return (
    <div className="space-y-6">
      <ReportsNav active="valuation" />

      <PageHeader
        title={t("valuation.title")}
        description={t("valuation.description")}
        actions={<ValuationFilter inStockOnly={inStockOnly} />}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t("valuation.statItems")} value={report.itemCount} />
        <StatCard label={t("valuation.statTotalValue")} value={formatMoney(report.totalValue)} />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState
          title={t("valuation.emptyTitle")}
          description={inStockOnly ? t("valuation.emptyInStock") : t("valuation.emptyDefault")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("valuation.colProduct")}</TableHead>
                <TableHead>{t("valuation.colSku")}</TableHead>
                <TableHead numeric>{t("valuation.colOnHand")}</TableHead>
                <TableHead numeric>{t("valuation.colCostPerUnit")}</TableHead>
                <TableHead numeric>{t("valuation.colValue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.sku}</TableCell>
                  <TableCell numeric>{formatQty(r.onHand, r.baseUnitCode)}</TableCell>
                  <TableCell numeric>{formatMoney(r.costPerBaseUnit)}</TableCell>
                  <TableCell numeric className="font-medium">{formatMoney(r.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
