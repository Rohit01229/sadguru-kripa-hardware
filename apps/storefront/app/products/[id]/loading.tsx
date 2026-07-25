import { getTranslations } from "next-intl/server";
import { Card, Skeleton } from "@hardware/ui";

// Layout-matched loading skeleton for the product detail page. Mirrors the
// max-w-3xl shell, title block, stock Badge, sale-unit Card, and add-to-cart panel
// of products/[id]/page.tsx so the pending state matches the resolved layout.
export default async function ProductLoading() {
  const t = await getTranslations("catalog");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" role="status" aria-label={t("detail.loading")}>
      <Skeleton className="h-4 w-20" />

      <div className="mt-3 space-y-2">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-40" />
      </div>

      <Skeleton className="mt-4 h-6 w-44 rounded-full" />

      <div className="mt-6 space-y-2">
        <Skeleton className="h-5 w-28" />
        <Card className="mt-2 divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </Card>
      </div>

      <Card className="mt-6 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-44" />
        </div>
      </Card>
    </div>
  );
}
