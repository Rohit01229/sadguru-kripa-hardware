import * as React from "react";
import { cn } from "../lib/cn";

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: "sm" | "default";
}

/**
 * Indeterminate loading spinner. Used by `Button isLoading` and Suspense
 * fallbacks. Honors prefers-reduced-motion (the spin only runs under
 * motion-safe). Decorative by default — pass an aria-label to make it announced.
 */
export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size = "default", "aria-label": ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      role={ariaLabel ? "status" : "presentation"}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      className={cn(
        "motion-safe:animate-spin text-current",
        size === "sm" ? "h-4 w-4" : "h-5 w-5",
        className,
      )}
      {...props}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  ),
);
Spinner.displayName = "Spinner";
