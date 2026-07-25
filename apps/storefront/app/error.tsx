"use client";

import * as React from "react";
import Link from "next/link";
import { Button, AlertTriangleIcon } from "@hardware/ui";

// App-wide error boundary (§4.4). Catches unexpected render/data errors in any
// storefront segment without a closer error.tsx, and offers a retry. Renders inside
// the chrome. Must be a Client Component.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 px-6 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangleIcon width={26} height={26} className="text-destructive" />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          We hit an unexpected problem loading this page. You can try again or head back to the
          catalog.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">Ref: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Browse the catalog</Link>
        </Button>
      </div>
    </div>
  );
}
