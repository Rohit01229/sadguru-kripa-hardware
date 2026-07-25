import { getTranslations } from "next-intl/server";
import { Card, Skeleton } from "@hardware/ui";

// Layout-matched loading skeleton for the order detail / tracking page. Mirrors the
// max-w-3xl shell, header row, timeline pills, lines Card, and totals of
// orders/[id]/page.tsx so the pending state matches the resolved layout.
export default async function OrderDetailLoading() {
  const t = await getTranslations("orders");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" role="status" aria-label={t("loadingOrder")}>
      <Skeleton className="h-4 w-24" />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-3 w-64" />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>

      <Card className="mt-6 divide-y">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>

      <div className="mt-4 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-5 w-full" />
      </div>
    </div>
  );
}
