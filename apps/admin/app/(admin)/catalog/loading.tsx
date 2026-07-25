import { PageHeader } from "@hardware/ui";
import { getTranslations } from "next-intl/server";
import { FilterBarSkeleton, TableSkeleton } from "../../_loading/skeletons";

// Route-level loading skeleton for the catalog list (§4.4). Mirrors the final layout —
// header, search/filter bar, and the products table — so the page does not fall back to
// the generic root spinner on slow searches or large catalogs.
export default async function CatalogLoading() {
  const t = await getTranslations("catalog");
  const tc = await getTranslations("common");
  return (
    <main className="space-y-6 p-6">
      <PageHeader title={tc("nav.catalog")} description={t("list.description")} />
      <FilterBarSkeleton fields={5} />
      <TableSkeleton columns={8} rows={10} />
    </main>
  );
}
