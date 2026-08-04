import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission, Forbidden, IMPORT_TEMPLATE_COLUMNS } from "@hardware/core";
import { Button, Card, CardContent, CardHeader, CardTitle, ForbiddenState, PageHeader } from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { ImportClient } from "./ImportClient";

/** The two columns a row genuinely cannot do without — everything else is optional. */
const REQUIRED_COLUMNS = new Set<string>(["Item Name", "Selling Price"]);

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

      {/* Step 1 — hand them a correct file rather than asking them to build one. */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-sm">{t("import.templateTitle")}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t("import.templateDescription")}</p>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <a href="/api/import/template">{t("import.downloadTemplate")}</a>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {IMPORT_TEMPLATE_COLUMNS.map((col) => (
              <span
                key={col}
                className={
                  REQUIRED_COLUMNS.has(col)
                    ? "rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-foreground"
                    : "rounded-md border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                }
              >
                {col}
                {REQUIRED_COLUMNS.has(col) && <span className="ml-1 text-primary">*</span>}
              </span>
            ))}
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>{t("import.noteRequired")}</li>
            <li>{t("import.notePrices")}</li>
            <li>{t("import.noteHeaders")}</li>
            <li>{t("import.noteFormats")}</li>
          </ul>
        </CardContent>
      </Card>

      <ImportClient />
    </div>
  );
}
