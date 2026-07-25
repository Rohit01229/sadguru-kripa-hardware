import { Spinner } from "@hardware/ui";

// App-wide route loading fallback (§4.4). Used by any (admin) segment without its
// own loading.tsx — the dashboard keeps a richer skeleton. Centered spinner so the
// shell stays put while a server component streams.
export default function Loading() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center text-muted-foreground"
      role="status"
      aria-label="Loading"
    >
      <Spinner />
    </div>
  );
}
