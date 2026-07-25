"use client";

import * as React from "react";
import { cn } from "../lib/cn";

// Lightweight dropdown menu (§2.3) — no Radix. Click-to-open, click-outside and
// Esc to close, focus returns to the trigger. Used for the admin topbar user menu
// and row "⋯" actions. Positioned relative to a wrapper; content is absolutely
// placed below the trigger.

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuId: string;
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null);

function useDropdownContext(component: string): DropdownContextValue {
  const ctx = React.useContext(DropdownContext);
  if (!ctx) throw new Error(`${component} must be used within <DropdownMenu>`);
  return ctx;
}

export function DropdownMenu({
  children,
  open: controlled,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const isControlled = controlled !== undefined;
  const open = isControlled ? controlled : uncontrolled;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuId = React.useId();

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const value = React.useMemo(
    () => ({ open, setOpen, triggerRef, menuId }),
    [open, setOpen, menuId],
  );

  return (
    <DropdownContext.Provider value={value}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownContext.Provider>
  );
}

export interface DropdownMenuTriggerProps {
  children: React.ReactElement;
}

export function DropdownMenuTrigger({ children }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef, menuId } = useDropdownContext("DropdownMenuTrigger");
  return React.cloneElement(children, {
    ref: triggerRef,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: (e: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      if (!e.defaultPrevented) setOpen(!open);
    },
  } as Record<string, unknown>);
}

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
}

export function DropdownMenuContent({
  className,
  children,
  align = "end",
  ...props
}: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef, menuId } = useDropdownContext("DropdownMenuContent");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // Focus first item.
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, setOpen, triggerRef]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      id={menuId}
      role="menu"
      className={cn(
        "absolute z-50 mt-1 min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md motion-safe:animate-zoom-in",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tints the item destructive (e.g. delete). */
  variant?: "default" | "destructive";
}

export const DropdownMenuItem = React.forwardRef<HTMLButtonElement, DropdownMenuItemProps>(
  ({ className, variant = "default", onClick, disabled, ...props }, ref) => {
    const ctx = React.useContext(DropdownContext);
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        disabled={disabled}
        className={cn(
          "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
          "focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
          variant === "destructive" && "text-destructive focus:bg-destructive/10 hover:bg-destructive/10",
          className,
        )}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) ctx?.setOpen(false);
        }}
        {...props}
      />
    );
  },
);
DropdownMenuItem.displayName = "DropdownMenuItem";

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-2 py-1.5 text-sm font-medium", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />;
}
