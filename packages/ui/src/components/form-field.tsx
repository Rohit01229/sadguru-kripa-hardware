import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

export interface FormFieldProps {
  /** Visible label text. */
  label: React.ReactNode;
  /** Marks the field required (adds a muted `*` and forwards `required` to the control). */
  required?: boolean;
  /** Helper text shown below the control (hidden when `error` is set). */
  hint?: React.ReactNode;
  /** Error message shown below the control; also flips the control to its invalid state. */
  error?: React.ReactNode;
  /** Stable id for the control. Auto-generated if omitted. */
  htmlFor?: string;
  className?: string;
  /**
   * The control. Receives `id`, `aria-invalid`, `aria-describedby`, and (when
   * `required`) `required` automatically, so callers don't have to wire them.
   */
  children: React.ReactElement;
}

/**
 * Label + control + helper/error stack (§2.1). Threads accessibility wiring
 * (`id` ↔ `htmlFor`, `aria-invalid`, `aria-describedby`) into the child control.
 */
export function FormField({
  label,
  required,
  hint,
  error,
  htmlFor,
  className,
  children,
}: FormFieldProps) {
  const reactId = React.useId();
  const id = htmlFor ?? (children.props as { id?: string }).id ?? reactId;
  const describedById = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const control = React.cloneElement(children, {
    id,
    required: required ?? (children.props as { required?: boolean }).required,
    "aria-invalid": error ? true : (children.props as Record<string, unknown>)["aria-invalid"],
    "aria-describedby":
      [describedById, (children.props as { ["aria-describedby"]?: string })["aria-describedby"]]
        .filter(Boolean)
        .join(" ") || undefined,
  } as Record<string, unknown>);

  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {control}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
