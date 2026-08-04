import { redirect } from "next/navigation";
import { getPlatformSession } from "../../../lib/platform-session";
import { PlatformLoginForm } from "./LoginForm";

// Platform (super-admin) sign-in — a separate realm from the shop login at /login.
// Deliberately unbranded: this is the operator's console, not a shop's, so it must not
// look like any tenant's storefront.
export default async function PlatformLoginPage() {
  if (await getPlatformSession()) redirect("/platform");
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Platform console</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage shops.</p>
        </div>
        <PlatformLoginForm />
      </div>
    </main>
  );
}
