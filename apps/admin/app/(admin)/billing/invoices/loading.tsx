import { getTranslations } from "next-intl/server";
import { PageHeader } from "@hardware/ui";
import { NavSkeleton, TableSkeleton } from "../../../_loading/skeletons";

// Route-level loading skeleton for the invoice day-book (§4.4). Mirrors the final
// layout — billing section nav, header, and the pakka-invoice table — so the page
// keeps its shape on slow DB loads instead of the generic root spinner.
export default async function InvoicesLoading() {
  const t = await getTranslations("billing");
  return (
    <div className="space-y-6">
      <NavSkeleton count={2} />
      <PageHeader
        title={t("invoices.title")}
        description={t("invoices.description")}
      />
      <TableSkeleton columns={7} rows={8} />
    </div>
  );
}
