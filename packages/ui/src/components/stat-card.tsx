import * as React from "react";
import { cn } from "../lib/cn";

/**
 * The element used to render the tile when it links somewhere. packages/ui is
 * framework-agnostic (no next/link dependency), so the app injects its router-aware link
 * (e.g. Next `<Link>`) to get client-side soft navigation. Defaults to a plain `<a>`.
 */
export type LinkComponent = React.ComponentType<{
  href: string;
  className?: string;
  children: React.ReactNode;
}>;

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Makes the whole tile a link to this route. */
  href?: string;
  /**
   * App-provided link element for `href` (e.g. Next `<Link>`) so an internal KPI tile
   * navigates client-side instead of reloading. Falls back to `<a>`.
   */
  linkComponent?: LinkComponent;
  /** Tints the value to signal an at-a-glance condition. */
  tone?: "default" | "warning" | "destructive";
  icon?: React.ReactNode;
  className?: string;
}

const toneClass: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  destructive: "text-destructive",
};

/** Dashboard / report KPI tile (§2.2). Replaces the copy-pasted `Stat` components. */
export function StatCard({
  label,
  value,
  sub,
  href,
  linkComponent: Link,
  tone = "default",
  icon,
  className,
}: StatCardProps) {
  const body = (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 text-card-foreground",
        href && "transition-colors hover:bg-muted/50",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", toneClass[tone])}>{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );

  if (href) {
    const linkClass =
      "block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    if (Link) {
      return (
        <Link href={href} className={linkClass}>
          {body}
        </Link>
      );
    }
    return (
      <a href={href} className={linkClass}>
        {body}
      </a>
    );
  }
  return body;
}
