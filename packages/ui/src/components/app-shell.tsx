"use client";

import * as React from "react";
import { cn } from "../lib/cn";

// Admin app shell (§3.1): fixed left Sidebar (w-60, collapses to a Sheet under lg)
// + sticky Topbar + scrollable content. These are PRESENTATIONAL shells — the app's
// (admin)/layout.tsx composes the RBAC-gated nav item list and the user menu and
// passes them in as slots. Nav items render whatever element the app provides
// (e.g. a Next <Link>) via `SidebarNavItem`'s `render`/`asChild` pattern.

export interface AppShellProps {
  /** Sidebar content (brand + SidebarNav). Shown fixed on lg+, inside a Sheet below. */
  sidebar: React.ReactNode;
  /** Topbar content (mobile menu button + section title + user menu). */
  topbar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Constrain content width (wide tables). Default `max-w-screen-2xl`. */
  contentClassName?: string;
}

export function AppShell({
  sidebar,
  topbar,
  children,
  className,
  contentClassName,
}: AppShellProps) {
  return (
    <div className={cn("min-h-screen bg-background", className)}>
      {/* Fixed sidebar on large screens. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card lg:flex">
        {sidebar}
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {topbar}
        </header>
        <main className={cn("mx-auto w-full max-w-screen-2xl p-6", contentClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Brand/header slot at the top of the sidebar. */
  brand?: React.ReactNode;
  /** Footer slot at the bottom (e.g. version, environment). */
  footer?: React.ReactNode;
}

export function Sidebar({ brand, footer, className, children, ...props }: SidebarProps) {
  return (
    <div className={cn("flex h-full flex-col", className)} {...props}>
      {brand ? (
        <div className="flex h-14 items-center border-b px-4">{brand}</div>
      ) : null}
      <div className="flex-1 overflow-y-auto py-4">{children}</div>
      {footer ? <div className="border-t p-4">{footer}</div> : null}
    </div>
  );
}

export function SidebarNav({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <nav className={cn("flex flex-col gap-1 px-3", className)} {...props} />;
}

export function SidebarNavGroup({
  label,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label?: React.ReactNode }) {
  return (
    <div className={cn("py-2", className)} {...props}>
      {label ? (
        <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

export interface SidebarNavItemProps {
  /** Active route highlight (primary tint + left accent bar). */
  active?: boolean;
  icon?: React.ReactNode;
  className?: string;
  /**
   * The link element (e.g. a Next `<Link>` or `<a>`). Its className is merged with
   * the nav-item styling and `aria-current` is set when active.
   */
  children: React.ReactElement;
}

/**
 * One sidebar nav row. Composes the app's link element so client-side routing and
 * `usePathname()` active detection stay in the app layer, while styling lives here.
 */
export function SidebarNavItem({ active, icon, className, children }: SidebarNavItemProps) {
  return React.cloneElement(children, {
    "aria-current": active ? "page" : undefined,
    className: cn(
      "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
      (children.props as { className?: string }).className,
    ),
    children: (
      <>
        {active ? (
          <span
            className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
            aria-hidden="true"
          />
        ) : null}
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="truncate">{(children.props as { children?: React.ReactNode }).children}</span>
      </>
    ),
  } as Record<string, unknown>);
}

export function Topbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex w-full items-center gap-3", className)} {...props} />;
}
