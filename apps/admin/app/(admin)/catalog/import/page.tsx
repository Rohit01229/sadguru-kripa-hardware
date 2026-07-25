import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission, Forbidden } from "@hardware/core";
import { Card, CardContent, CardHeader, CardTitle, ForbiddenState, PageHeader } from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { ImportClient } from "./ImportClient";

const COLUMNS = [
  "sku",
  "name",
  "category",
  "brand",
  "hsnCode",
  "gstRatePct",
  "baseUnitCode",
  "baseUnitKind",
  "saleUnitCode",
  "saleUnitKind",
  "factorToBase",
  "salePrice",
  "mrp",
  "costPerBaseUnit",
  "priceInclusive",
  "openingStock",
];

export default async function ImportPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "import.catalog");
  } catch (e) {
    if (e instanceof Forbidden) {
      return (
        <div className="space-y-6">
          <ForbiddenState perm="import.catalog" />
        </div>
      );
    }
    throw e;
  }

  const t = await getTranslations("catalog");
  const tc = await getTranslations("common");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("import.title")}
        description={t("import.description")}
        breadcrumbs={[{ label: tc("nav.catalog"), href: "/catalog" }, { label: t("import.breadcrumb") }]}
        linkComponent={Link}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("import.expectedColumns")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {COLUMNS.map((col) => (
              <code
                key={col}
                className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
              >
                {col}
              </code>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t.rich("import.pricesNote", {
              sale: (chunks) => <code className="font-mono">{chunks}</code>,
              mrp: (chunks) => <code className="font-mono">{chunks}</code>,
              cost: (chunks) => <code className="font-mono">{chunks}</code>,
            })}
          </p>
        </CardContent>
      </Card>

      <ImportClient />
    </div>
  );
}
