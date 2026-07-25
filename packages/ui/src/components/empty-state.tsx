import * as React from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Action slot — a `Button`/link (or a row of them). */
  action?: React.ReactNode;
  className?: string;
}

/** Centered placeholder for empty lists / no-data states (§4.4). */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-3 text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export interface ForbiddenStateProps {
  /** The permission key the destination enforces server-side (wording preserved). */
  perm: string;
  className?: string;
}

/**
 * Shared 403 preset replacing the duplicated `Forbid` components in the `*Nav`
 * files. Names the missing permission with the exact existing wording.
 */
export function ForbiddenState({ perm, className }: ForbiddenStateProps) {
  return (
    <EmptyState
      className={className}
      title="403 — Forbidden"
      description={
        <>
          You do not have the <code className="font-mono">{perm}</code> permission.
        </>
      }
    />
  );
}
