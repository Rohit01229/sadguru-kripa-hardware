import Link from "next/link";
import { Button } from "@hardware/ui";

// App-wide 404 (§4.4). Renders inside the storefront chrome. Friendly, roomy,
// retail tone with a clear way back to the catalog.
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 px-6 py-20 text-center">
      <div className="space-y-2">
        <p className="text-6xl font-semibold tracking-tight text-muted-foreground">404</p>
        <h1 className="text-2xl font-semibold">We couldn’t find that page</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page may have moved or the link is out of date. Browse the catalog to find what you
          need.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/">Browse the catalog</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/orders">My orders</Link>
        </Button>
      </div>
    </div>
  );
}
