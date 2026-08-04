"use client";

import * as React from "react";
import { Button, AlertTriangleIcon } from "@hardware/ui";

// App-wide error boundary (§4.4). Catches unexpected render/data errors in any
// segment without a closer error.tsx, and offers a retry (reset()) — friendly card,
// no stack trace shown to staff. Must be a Client Component.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // `redirect()` and `notFound()` work by THROWING a control-flow error. If this
  // boundary rendered its "something went wrong" card for those, a guard that redirects
  // an unauthenticated visitor would show an error page instead of the login screen.
  // Re-throw them so Next can do its job; only real failures reach the card below.
  if (isControlFlowError(error)) throw error;

  React.useEffect(() => {
    // Surface for server log correlation without leaking details to the UI.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangleIcon width={26} height={26} className="text-destructive" />
      </span>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred while loading this page. You can try again.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">Ref: {error.digest}</p>
        ) : null}
      </div>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}

/**
 * True for Next's internal control-flow errors — the ones `redirect()` and `notFound()`
 * throw. Next tags them on `digest` ("NEXT_REDIRECT" / "NEXT_NOT_FOUND"); we match on
 * the prefix so a redirect's appended status code still matches.
 */
function isControlFlowError(error: Error & { digest?: string }): boolean {
  const digest = typeof error.digest === "string" ? error.digest : "";
  return digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND";
}
