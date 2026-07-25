import { getTranslations } from "next-intl/server";
import { Card, PageHeader, Skeleton } from "@hardware/ui";

// Layout-matched loading skeleton for the order history list. Mirrors the
// max-w-3xl shell + PageHeader + divided Card rows of orders/page.tsx so the
// pending state matches the resolved layout (vs the generic root spinner).
export default async function OrdersLoading() {
  const t = await getTranslations("orders");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" role="status" aria-label={t("loadingOrders")}>
      <PageHeader size="2xl" title={t("title")} />
      <Card className="mt-6 divide-y">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
