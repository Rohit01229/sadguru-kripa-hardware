import { PageHeader } from "@hardware/ui";
import { getTranslations } from "next-intl/server";
import {
  NavSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "../../_loading/skeletons";

// Route-level loading skeleton for the stock list (§4.4). Mirrors the final layout —
// stock section nav, header, search/low-stock filter bar, and the on-hand table — so
// the page keeps its shape on slow DB loads instead of the generic root spinner.
export default async function StockLoading() {
  const t = await getTranslations("stock");
  return (
    <div className="space-y-6">
      <NavSkeleton count={6} />
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
      />
      <FilterBarSkeleton fields={2} />
      <TableSkeleton columns={8} rows={10} />
    </div>
  );
}
