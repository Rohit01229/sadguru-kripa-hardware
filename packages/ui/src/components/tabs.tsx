"use client";

import * as React from "react";
import { cn } from "../lib/cn";

// Underline tabs (§2.3). Two modes:
//  1) Interactive content switcher — <Tabs value/defaultValue>, TabsTrigger value=…,
//     TabsContent value=… (panel toggling, roving focus).
//  2) Link/navigation mode — render TabsList with TabsLink children (or pass
//     `asChild` to TabsTrigger) so section nav (Stock/Billing/Ledger/Reports) gets
//     one consistent active-aware underline pattern. In link mode set `active`.

interface TabsContextValue {
  value: string | undefined;
  setValue: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : uncontrolled;

  const setValue = React.useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const ctx = React.useMemo(() => ({ value, setValue }), [value, setValue]);

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn("space-y-4", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex flex-wrap items-center gap-4 border-b text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

const triggerBase =
  "-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-2 pt-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const triggerInactive =
  "border-transparent text-muted-foreground hover:border-border hover:text-foreground";
const triggerActive = "border-primary text-foreground";

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({ value, className, ...props }: TabsTriggerProps) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger must be used within <Tabs>");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(triggerBase, active ? triggerActive : triggerInactive, className)}
      onClick={() => ctx.setValue(value)}
      {...props}
    />
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent must be used within <Tabs>");
  if (ctx.value !== value) return null;
  return <div role="tabpanel" className={cn("focus-visible:outline-none", className)} {...props} />;
}

/**
 * Navigation-mode tab. Render inside a `TabsList` and pass a Next `<Link>`/`<a>` as
 * the child plus `active`. Section nav bars use this so route links share the same
 * underline + active style as interactive tabs.
 */
export interface TabsLinkProps {
  active?: boolean;
  className?: string;
  children: React.ReactElement;
}

export function TabsLink({ active, className, children }: TabsLinkProps) {
  return React.cloneElement(children, {
    role: "tab",
    "aria-selected": active,
    "aria-current": active ? "page" : undefined,
    className: cn(
      triggerBase,
      active ? triggerActive : triggerInactive,
      (children.props as { className?: string }).className,
      className,
    ),
  } as Record<string, unknown>);
}
