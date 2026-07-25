import { Skeleton, TabsList } from "@hardware/ui";

// Shared building blocks for route-level loading.tsx skeletons (§4.4). The `_loading`
// folder is a private (underscore) segment so Next never treats it as a route. These
// mirror the final list-page layout — section nav, filter bar, and a DataTable-shaped
// table — so data-heavy routes show a layout-matched skeleton instead of the generic
// root spinner while a server component streams.

/** Section-nav (Tabs link bar) placeholder — a row of pill-width bars on a bottom border. */
export function NavSkeleton({ count = 4 }: { count?: number }) {
  return (
    <TabsList aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="my-1 h-4 w-20" />
      ))}
    </TabsList>
  );
}

/** Filter/search bar placeholder — a row of input-shaped bars plus a button. */
export function FilterBarSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {Array.from({ length: fields }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-44" />
      ))}
      <Skeleton className="h-9 w-24" />
    </div>
  );
}

/** Stat-card grid placeholder — mirrors the StatCard tiles on report pages. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-6 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * Table placeholder shaped like the shared Table/DataTable — a header row of column
 * labels over `rows` body rows. Wrapped in the same bordered, scrollable shell the
 * real tables use so the page does not jump when data arrives.
 */
export function TableSkeleton({
  columns = 6,
  rows = 8,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border" role="status" aria-label="Loading">
      <div className="min-w-full divide-y">
        <div className="flex gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" />
          ))}
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex gap-4 px-4 py-3.5">
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton key={c} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
