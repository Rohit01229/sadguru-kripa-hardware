import { getTranslations } from "next-intl/server";
import { PageHeader } from "@hardware/ui";
import { NavSkeleton, StatGridSkeleton, TableSkeleton } from "../../../_loading/skeletons";

// Route-level loading skeleton for the stock-valuation report (§4.4). Mirrors the final
// layout — reports section nav, header (with its in-stock-only toggle in the actions
// slot), two KPI tiles, and the per-product valuation table — to avoid a layout jump on
// slow DB loads.
export default async function ValuationLoading() {
  const t = await getTranslations("reports");
  return (
    <div className="space-y-6">
      <NavSkeleton count={4} />
      <PageHeader
        title={t("valuation.title")}
        description={t("valuation.description")}
      />
      <StatGridSkeleton count={2} />
      <TableSkeleton columns={5} rows={8} />
    </div>
  );
}
