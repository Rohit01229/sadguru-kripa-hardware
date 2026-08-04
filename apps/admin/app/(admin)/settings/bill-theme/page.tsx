import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getBillTheme, getFullStoreConfig, requirePermission, Forbidden } from "@hardware/core";
import { ForbiddenState, PageHeader } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { ThemeEditor } from "./ThemeEditor";

// Settings → Bill theme (19 §7). The no-code editor for how printed bills look.
export default async function BillThemePage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    // Same gate as the rest of settings — theming a tax invoice is an owner decision.
    requirePermission(session, "settings.write");
  } catch (e) {
    if (e instanceof Forbidden) {
      return (
        <div className="space-y-6">
          <ForbiddenState perm="settings.write" />
        </div>
      );
    }
    throw e;
  }

  const t = await getTranslations("settings");
  const tc = await getTranslations("common");
  const shopId = await requireShopId();
  const [theme, config] = await Promise.all([getBillTheme(shopId), getFullStoreConfig(shopId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("billTheme.title")}
        description={t("billTheme.description")}
        breadcrumbs={[{ label: tc("nav.settings"), href: "/settings" }, { label: t("billTheme.breadcrumb") }]}
        linkComponent={Link}
      />
      <ThemeEditor
        initialTheme={theme}
        branding={{
          name: config?.name ?? "My Hardware Store",
          address: config?.address ?? null,
          gstin: config?.gstin ?? null,
          bankDetails: config?.bankDetails ?? null,
          invoiceTerms: config?.invoiceTerms ?? null,
          logoKey: config?.logoKey ?? null,
        }}
      />
    </div>
  );
}
