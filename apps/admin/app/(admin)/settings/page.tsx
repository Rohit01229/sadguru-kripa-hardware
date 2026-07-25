import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getFullStoreConfig, requirePermission, can, Forbidden } from "@hardware/core";
import {
  PageHeader,
  Card,
  CardContent,
  ForbiddenState,
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { SettingsForm } from "./SettingsForm";

// Store settings screen (S7; settings.read to view, settings.write to edit). The
// single "default" StoreConfig drives invoices/orders/prints (13 §10). The form is
// shown only with settings.write (cosmetic); the action re-checks server-side.
export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "settings.read");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="settings.read" />;
    throw e;
  }

  const config = await getFullStoreConfig();
  if (!config) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("page.uninitTitle")}
          description={t.rich("page.uninitDescription", {
            code: (chunks) => <code>{chunks}</code>,
          })}
        />
      </div>
    );
  }

  const canWrite = can(session, "settings.write");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
      />
      {canWrite ? (
        <SettingsForm config={config} />
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            <p className="text-muted-foreground">
              {t.rich("page.readOnly", { code: (chunks) => <code>{chunks}</code> })}
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <Item k={t("page.summaryShopName")} v={config.name} />
              <Item k={t("page.summaryGstin")} v={config.gstin ?? "—"} />
              <Item k={t("page.summaryHomeState")} v={config.homeState} />
              <Item k={t("page.summaryInvoicePrefix")} v={config.invoicePrefixFormat} />
              <Item k={t("page.summaryGstRounding")} v={config.gstRoundingMode} />
              <Item k={t("page.summaryReservationTtl")} v={t("page.minutesShort", { minutes: config.reservationTtlMinutes })} />
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
