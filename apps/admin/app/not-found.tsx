import Link from "next/link";
import { Button } from "@hardware/ui";

// App-wide 404 (§4.4). Rendered by Next when a route or notFound() has no match.
// Standalone (no shell) — the root layout supplies <body>; we center a friendly card.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 p-6 text-center">
      <div className="space-y-2">
        <p className="text-5xl font-semibold tracking-tight text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </main>
  );
}
