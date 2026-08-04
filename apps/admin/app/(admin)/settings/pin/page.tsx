import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { currentDevicePinStatus } from "./actions";
import { PinSetup } from "./PinSetup";

// Settings → Quick sign-in. Any signed-in staff member may set a PIN for the device
// they are holding; it is their own credential, not a shop-wide setting, so this needs
// no extra permission beyond being authenticated.
export default async function PinSettingsPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  const { hasPin } = await currentDevicePinStatus();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Quick sign-in"
        description="Use a 4-digit PIN on this device instead of your password."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Quick sign-in" }]}
        linkComponent={Link}
      />
      <PinSetup hasPin={hasPin} />
    </div>
  );
}
