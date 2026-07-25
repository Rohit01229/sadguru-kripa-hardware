import { getTranslations } from "next-intl/server";
import { PageHeader, Skeleton } from "@hardware/ui";
import { NavSkeleton, TableSkeleton } from "../../../_loading/skeletons";

// Route-level loading skeleton for the GSTR-1 export (§4.4). Mirrors the final layout —
// reports section nav, header (period picker + CSV download live in the actions slot),
// six KPI tiles, and the B2B / B2C / credit-note / HSN sections — so the page holds its
// shape while the period's invoices are reconciled on a slow DB load.
export default async function Gstr1Loading() {
  const t = await getTranslations("reports");
  return (
    <div className="space-y-6">
      <NavSkeleton count={4} />
      <PageHeader
        title={t("gstr1.loadingTitle")}
        description={t("gstr1.description")}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-24" />
          </div>
        ))}
      </div>

      {Array.from({ length: 4 }).map((_, i) => (
        <section key={i} className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <TableSkeleton columns={i < 2 ? 9 : 5} rows={3} />
        </section>
      ))}
    </div>
  );
}
