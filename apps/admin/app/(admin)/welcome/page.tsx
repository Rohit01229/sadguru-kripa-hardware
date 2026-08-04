import { redirect } from "next/navigation";
import { getOnboardingState, getFullStoreConfig, requirePermission, Forbidden } from "@hardware/core";
import { ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../lib/session";
import { WelcomeWizard } from "./WelcomeWizard";

// First-run wizard (16 §6). Reached automatically from the dashboard on a shop that has
// never been set up; harmless to visit later (it just re-runs the steps).
export default async function WelcomePage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    // Setting up the shop is an owner action — the same gate as Settings.
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

  const shopId = await requireShopId();
  const [state, config] = await Promise.all([getOnboardingState(shopId), getFullStoreConfig(shopId)]);

  // Already set up — nothing to do here. Send them to the app rather than showing a
  // wizard they have completed.
  if (!state.pending) redirect("/dashboard");
  if (!config) redirect("/dashboard");

  return <WelcomeWizard config={config} state={state} shopName={config.name} />;
}
