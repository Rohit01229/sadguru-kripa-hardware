import { getTranslations } from "next-intl/server";
import { PageHeader } from "@hardware/ui";
import {
  NavSkeleton,
  FilterBarSkeleton,
  StatGridSkeleton,
  TableSkeleton,
} from "../../../_loading/skeletons";

// Route-level loading skeleton for the sales report (§4.4). Mirrors the final layout —
// reports section nav, header, date/group-by filter bar, four KPI tiles, and the
// grouped totals table — so the page does not jump on slow DB loads.
export default async function SalesReportLoading() {
  const t = await getTranslations("reports");
  return (
    <div className="space-y-6">
      <NavSkeleton count={4} />
      <PageHeader
        title={t("sales.title")}
        description={t("sales.description")}
      />
      <FilterBarSkeleton fields={3} />
      <StatGridSkeleton count={4} />
      <TableSkeleton columns={6} rows={8} />
    </div>
  );
}
