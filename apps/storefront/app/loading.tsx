import { getTranslations } from "next-intl/server";
import { Card, PageHeader, Skeleton } from "@hardware/ui";

// Layout-matched loading skeleton for the catalog (app/page.tsx). Mirrors the
// max-w-6xl shell, PageHeader, search bar, the filter sidebar (md+) and the
// responsive 1→2→3→4 product-card grid so the streaming state matches the resolved
// layout. The home route is the storefront's heavy async page; the other co-level
// routes (cart/checkout/auth) are instant client components.
export default async function CatalogLoading() {
  const t = await getTranslations("catalog");
  return (
    <div
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6"
      role="status"
      aria-label={t("loadingCatalog")}
    >
      <PageHeader
        size="2xl"
        title={t("heading")}
        description={t("description")}
      />

      {/* Search bar */}
      <div className="mt-6 flex gap-2">
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-9 w-20" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[16rem_1fr]">
        {/* Filters: a "Filters" button on mobile, a sidebar on desktop. */}
        <div>
          <Skeleton className="h-9 w-full md:hidden" />
          <div className="hidden space-y-4 md:block">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>

        {/* Product card grid (1 → 2 → 3 → 4 columns). */}
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <Card className="flex h-full flex-col p-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
                <div className="mt-6 pt-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-2 h-5 w-20 rounded-full" />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
