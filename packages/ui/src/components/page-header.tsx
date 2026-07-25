import * as React from "react";
import { cn } from "../lib/cn";

export interface Breadcrumb {
  label: React.ReactNode;
  href?: string;
}

/**
 * The element used to render a breadcrumb link. packages/ui is framework-agnostic (no
 * next/link dependency), so the app injects its router-aware link (e.g. Next `<Link>`)
 * to get client-side soft navigation. Defaults to a plain `<a>` when omitted.
 */
export type LinkComponent = React.ComponentType<{
  href: string;
  className?: string;
  children: React.ReactNode;
}>;

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned slot for primary/secondary action buttons. */
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  /**
   * App-provided link element for breadcrumb hrefs (e.g. Next `<Link>`) so internal
   * breadcrumbs navigate client-side instead of reloading. Falls back to `<a>`.
   */
  linkComponent?: LinkComponent;
  /** Title size — admin uses `text-xl`, storefront `text-2xl`. Default `xl`. */
  size?: "xl" | "2xl";
  className?: string;
}

/** Standard page opener: breadcrumbs + title + description + right-aligned actions (§4.1). */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  linkComponent: Link,
  size = "xl",
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, i) => {
              const last = i === breadcrumbs.length - 1;
              const linkClass = "hover:text-foreground hover:underline";
              return (
                <li key={i} className="flex items-center gap-1">
                  {crumb.href && !last ? (
                    Link ? (
                      <Link href={crumb.href} className={linkClass}>
                        {crumb.label}
                      </Link>
                    ) : (
                      <a href={crumb.href} className={linkClass}>
                        {crumb.label}
                      </a>
                    )
                  ) : (
                    <span className={last ? "text-foreground" : undefined}>{crumb.label}</span>
                  )}
                  {!last ? <span aria-hidden="true">/</span> : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className={cn("font-semibold", size === "2xl" ? "text-2xl" : "text-xl")}>{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
