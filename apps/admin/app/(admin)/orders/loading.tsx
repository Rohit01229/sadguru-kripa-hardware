import { getTranslations } from "next-intl/server";
import { PageHeader } from "@hardware/ui";
import { NavSkeleton, TableSkeleton } from "../../_loading/skeletons";

// Route-level loading skeleton for the admin order queue (§4.4). Mirrors the final
// layout — header, the status filter tabs, and the orders DataTable — so the queue
// holds its shape on slow loads instead of the generic root spinner.
export default async function OrdersLoading() {
  const t = await getTranslations("orders");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <NavSkeleton count={8} />
      <TableSkeleton columns={7} rows={8} />
    </div>
  );
}
