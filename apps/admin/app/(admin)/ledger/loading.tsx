import { getTranslations } from "next-intl/server";
import { PageHeader } from "@hardware/ui";
import { NavSkeleton, TableSkeleton } from "../../_loading/skeletons";

// Route-level loading skeleton for the khata directory (§4.4). Mirrors the final
// layout — ledger section nav, header, and the receivables DataTable (per-customer
// aging is computed server-side, so this list can be slow) — instead of the generic
// root spinner.
export default async function LedgerLoading() {
  const t = await getTranslations("ledger");
  return (
    <div className="space-y-6">
      <NavSkeleton count={1} />
      <PageHeader
        title={t("directory.title")}
        description={t("directory.description")}
      />
      <TableSkeleton columns={8} rows={8} />
    </div>
  );
}
