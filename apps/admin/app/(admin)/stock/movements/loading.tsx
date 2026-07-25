import { PageHeader } from "@hardware/ui";
import { getTranslations } from "next-intl/server";
import {
  NavSkeleton,
  FilterBarSkeleton,
  TableSkeleton,
} from "../../../_loading/skeletons";

// Route-level loading skeleton for the movement ledger (§4.4). Mirrors the final
// layout — stock section nav, header, the date filter bar, and the movements table —
// so the page does not fall back to the generic root spinner on slow DB loads.
export default async function MovementsLoading() {
  const t = await getTranslations("stock");
  return (
    <div className="space-y-6">
      <NavSkeleton count={6} />
      <PageHeader
        title={t("movements.title")}
        description={t("movements.description")}
      />
      <FilterBarSkeleton fields={2} />
      <TableSkeleton columns={6} rows={10} />
    </div>
  );
}
