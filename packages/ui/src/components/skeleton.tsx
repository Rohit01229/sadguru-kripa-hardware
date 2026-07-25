import * as React from "react";
import { cn } from "../lib/cn";

/** Loading placeholder block. Compose into rows/cards that match the final layout. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("motion-safe:animate-pulse rounded-md bg-muted", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
