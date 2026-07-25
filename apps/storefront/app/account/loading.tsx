import { Card, CardContent, CardHeader, PageHeader, Skeleton } from "@hardware/ui";
import { getTranslations } from "next-intl/server";

// Layout-matched loading skeleton for the account page. Mirrors the max-w-3xl shell,
// PageHeader, and the Profile + Addresses Cards of account/page.tsx so the pending
// state matches the resolved layout.
export default async function AccountLoading() {
  const t = await getTranslations("account");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" role="status" aria-label={t("page.loadingLabel")}>
      <PageHeader size="2xl" title={t("page.title")} description={t("page.descriptionSignedIn")} />

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-28" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-9 w-28" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
