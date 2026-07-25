"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { XIcon, CheckCircleIcon, AlertTriangleIcon, InfoIcon } from "./icons";

// Toast feedback channel (§4.5). A module-level store lets `toast()` be called from
// anywhere (event handlers, after server-action results) while a single <Toaster/>
// mounted at the app root renders the queue. No sonner dependency.

type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  description?: string;
  /** Auto-dismiss after N ms. Default 4000; pass 0 to keep until dismissed. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
  type: ToastType;
  title: string;
}

type Listener = (toasts: ToastRecord[]) => void;

let toasts: ToastRecord[] = [];
let counter = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

function add(type: ToastType, title: string, options?: ToastOptions): number {
  const id = ++counter;
  toasts = [...toasts, { id, type, title, ...options }];
  emit();
  return id;
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Imperative toast API: `toast.success("Saved")`, `toast.error(msg)`, `toast.info(msg)`. */
export const toast = {
  success: (title: string, options?: ToastOptions) => add("success", title, options),
  error: (title: string, options?: ToastOptions) => add("error", title, options),
  info: (title: string, options?: ToastOptions) => add("info", title, options),
  dismiss,
};

const iconFor: Record<ToastType, React.ReactNode> = {
  success: <CheckCircleIcon width={18} height={18} className="text-emerald-600 dark:text-emerald-400" />,
  error: <AlertTriangleIcon width={18} height={18} className="text-destructive" />,
  info: <InfoIcon width={18} height={18} className="text-blue-600 dark:text-blue-400" />,
};

function ToastItem({ record }: { record: ToastRecord }) {
  const { id, type, title, description, duration = 4000 } = record;

  React.useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => dismiss(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration]);

  return (
    <div
      role="status"
      aria-live={type === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-lg motion-safe:animate-slide-in-right",
      )}
    >
      <span className="mt-0.5 shrink-0">{iconFor[type]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(id)}
        aria-label="Dismiss"
        className="shrink-0 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon width={16} height={16} />
      </button>
    </div>
  );
}

/** Mount once per app root (after children). Renders the toast queue, bottom-right. */
export function Toaster({ className }: { className?: string }) {
  const [items, setItems] = React.useState<ToastRecord[]>([]);

  React.useEffect(() => {
    const listener: Listener = (next) => setItems(next);
    listeners.add(listener);
    setItems([...toasts]);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4",
        className,
      )}
    >
      {items.map((record) => (
        <ToastItem key={record.id} record={record} />
      ))}
    </div>
  );
}
