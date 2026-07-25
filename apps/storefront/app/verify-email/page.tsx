import { Suspense } from "react";
import { Spinner } from "@hardware/ui";
import { VerifyEmailClient } from "./VerifyEmailClient";

// Verify-email landing page. The verification email links here with a single-use
// `?token=` query param; the client posts it to the existing
// POST /api/customer/verify-email route (behavior unchanged) and renders the
// success / invalid / pending states. useSearchParams requires a Suspense boundary.
export default function VerifyEmailPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Spinner />
          </div>
        }
      >
        <VerifyEmailClient />
      </Suspense>
    </div>
  );
}
