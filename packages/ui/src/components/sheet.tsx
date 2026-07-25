"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { useDismissableLayer } from "../lib/use-dismissable-layer";
import { XIcon } from "./icons";

// Side/bottom drawer (§2.3). Shares behavior with Dialog (focus trap, Esc, scroll
// lock, overlay close). Used for the storefront mobile nav and the admin mobile
// sidebar.

interface SheetContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheetContext(component: string): SheetContextValue {
  const ctx = React.useContext(SheetContext);
  if (!ctx) throw new Error(`${component} must be used within <Sheet>`);
  return ctx;
}

export interface SheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Sheet({ open: controlled, defaultOpen, onOpenChange, children }: SheetProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen ?? false);
  const isControlled = controlled !== undefined;
  const open = isControlled ? controlled : uncontrolled;
  const titleId = React.useId();
  const descriptionId = React.useId();

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const value = React.useMemo(
    () => ({ open, setOpen, titleId, descriptionId }),
    [open, setOpen, titleId, descriptionId],
  );

  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}

export function SheetTrigger({ children }: { children: React.ReactElement }) {
  const { setOpen } = useSheetContext("SheetTrigger");
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      if (!e.defaultPrevented) setOpen(true);
    },
  } as Record<string, unknown>);
}

type Side = "right" | "left" | "bottom" | "top";

const sideClasses: Record<Side, string> = {
  right: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l motion-safe:animate-slide-in-right",
  left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r motion-safe:animate-slide-in-left",
  bottom: "inset-x-0 bottom-0 max-h-[80vh] border-t motion-safe:animate-slide-in-bottom",
  top: "inset-x-0 top-0 max-h-[80vh] border-b motion-safe:animate-slide-in-top",
};

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: Side;
  hideClose?: boolean;
}

export function SheetContent({
  className,
  children,
  side = "right",
  hideClose,
  ...props
}: SheetContentProps) {
  const { open, setOpen, titleId, descriptionId } = useSheetContext("SheetContent");
  const ref = useDismissableLayer<HTMLDivElement>({ open, onClose: () => setOpen(false) });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50 motion-safe:animate-fade-in"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "absolute z-10 flex flex-col gap-4 overflow-y-auto bg-card p-6 text-card-foreground shadow-lg",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose ? (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <XIcon width={18} height={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1.5 pr-8", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useSheetContext("SheetTitle");
  return (
    <h2 id={titleId} className={cn("text-lg font-semibold leading-none", className)} {...props} />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useSheetContext("SheetDescription");
  return (
    <p id={descriptionId} className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />;
}

export function SheetClose({ children }: { children: React.ReactElement }) {
  const { setOpen } = useSheetContext("SheetClose");
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      if (!e.defaultPrevented) setOpen(false);
    },
  } as Record<string, unknown>);
}
