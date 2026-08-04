import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getFullStoreConfig, requirePermission, can, Forbidden } from "@hardware/core";
import Link from "next/link";
import {
  PageHeader,
  Button,
  Card,
  CardContent,
  ForbiddenState,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../lib/session";
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

  const shopId = await requireShopId();
  const config = await getFullStoreConfig(shopId);
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
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Quick sign-in</p>
            <p className="text-xs text-muted-foreground">
              Use a 4-digit PIN on this device instead of your password.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/pin">Set up</Link>
          </Button>
        </CardContent>
      </Card>
      {canWrite && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">{t("billTheme.title")}</p>
              <p className="text-xs text-muted-foreground">{t("billTheme.description")}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/bill-theme">{t("billTheme.open")}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
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
