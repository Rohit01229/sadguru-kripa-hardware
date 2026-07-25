import { Suspense } from "react";
import { Spinner } from "@hardware/ui";
import { ResetPasswordClient } from "./ResetPasswordClient";

// Password-reset landing page. The reset email links here with a single-use
// `?token=` query param; the client collects a new password and posts it to the
// existing POST /api/customer/password/reset route (behavior unchanged), which
// revokes all sessions on success. useSearchParams requires a Suspense boundary.
export default function ResetPasswordPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Spinner />
          </div>
        }
      >
        <ResetPasswordClient />
      </Suspense>
    </div>
  );
}
