import {
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Skeleton,
} from "@hardware/ui";
import { getTranslations } from "next-intl/server";

// Route-level loading skeleton for the dashboard (§4.4). Mirrors the final layout —
// PageHeader, four KPI tiles, two list cards — so the page does not jump on data load.
export default async function DashboardLoading() {
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");
  return (
    <div className="space-y-6">
      <PageHeader
        title={tc("nav.dashboard")}
        description={t("description")}
      />

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-16" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((_, r) => (
                <div key={r} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
