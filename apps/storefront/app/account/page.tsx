import { getProfile } from "@hardware/core";
import { Button, PageHeader } from "@hardware/ui";
import { getTranslations } from "next-intl/server";
import { getCustomerSession } from "../../lib/session";
import { AccountClient } from "./AccountClient";
import { AuthForms } from "./AuthForms";
import { logoutAction } from "./actions";

// Customer account: profile + addresses + order-history link (04 Customer accounts).
// Signed out → login/register; signed in → manage profile + addresses.
export default async function AccountPage() {
  const t = await getTranslations("account");
  const tc = await getTranslations("common");
  const session = await getCustomerSession();

  if (!session || !session.customerId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PageHeader size="2xl" title={t("page.title")} description={t("page.descriptionSignedOut")} />
        <AuthForms />
      </div>
    );
  }

  const profile = await getProfile(session.customerId);
  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PageHeader size="2xl" title={t("page.title")} description={t("page.descriptionSignedOut")} />
        <AuthForms />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        size="2xl"
        title={t("page.title")}
        description={t("page.descriptionSignedIn")}
        actions={
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="h-11 sm:h-9">
              {tc("shell.signOut")}
            </Button>
          </form>
        }
      />
      <AccountClient profile={profile} />
    </div>
  );
}
