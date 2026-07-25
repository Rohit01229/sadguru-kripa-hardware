import { getTranslations } from "next-intl/server";
import { PageHeader } from "@hardware/ui";
import { FilterBarSkeleton, TableSkeleton } from "../../_loading/skeletons";

// Route-level loading skeleton for the audit log (§4.4). Mirrors the final layout —
// header, the action/target/date filter bar, and the append-only log table — so the
// page does not jump on slow DB loads.
export default async function AuditLoading() {
  const t = await getTranslations("audit");
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <FilterBarSkeleton fields={4} />
      <TableSkeleton columns={5} rows={10} />
    </div>
  );
}
