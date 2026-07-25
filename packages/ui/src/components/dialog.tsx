"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { useDismissableLayer } from "../lib/use-dismissable-layer";
import { XIcon } from "./icons";

// Accessible modal dialog (§2.3). Radix-style compound API, but dependency-free:
// focus-trapped, Esc-to-close, scroll-locked, overlay click closes, restores focus
// on close. Rendered with position:fixed (no portal) so it needs no react-dom types.

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error(`${component} must be used within <Dialog>`);
  return ctx;
}

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open: controlled, defaultOpen, onOpenChange, children }: DialogProps) {
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

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export interface DialogTriggerProps {
  children: React.ReactElement;
  asChild?: boolean;
}

export function DialogTrigger({ children }: DialogTriggerProps) {
  const { setOpen } = useDialogContext("DialogTrigger");
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      if (!e.defaultPrevented) setOpen(true);
    },
  } as Record<string, unknown>);
}

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Hide the built-in top-right close button. */
  hideClose?: boolean;
}

export function DialogContent({ className, children, hideClose, ...props }: DialogContentProps) {
  const { open, setOpen, titleId, descriptionId } = useDialogContext("DialogContent");
  const ref = useDismissableLayer<HTMLDivElement>({ open, onClose: () => setOpen(false) });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
          "relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 text-card-foreground shadow-lg motion-safe:animate-zoom-in",
          "max-h-[calc(100vh-2rem)] overflow-y-auto",
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

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 space-y-1.5 pr-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext("DialogTitle");
  return (
    <h2 id={titleId} className={cn("text-lg font-semibold leading-none", className)} {...props} />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialogContext("DialogDescription");
  return (
    <p id={descriptionId} className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export interface DialogCloseProps {
  children: React.ReactElement;
}

export function DialogClose({ children }: DialogCloseProps) {
  const { setOpen } = useDialogContext("DialogClose");
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      if (!e.defaultPrevented) setOpen(false);
    },
  } as Record<string, unknown>);
}
