import * as React from "react";
import { cn } from "../lib/cn";

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Storefront rhythm: `5xl` for lists, `3xl` for detail/forms. Default `5xl`. */
  size?: "3xl" | "5xl" | "2xl";
}

const sizeClass: Record<NonNullable<ContainerProps["size"]>, string> = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
};

/** Centered content wrapper applying the storefront `mx-auto max-w-* px-6` rhythm. */
export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, size = "5xl", ...props }, ref) => (
    <div ref={ref} className={cn("mx-auto w-full px-6", sizeClass[size], className)} {...props} />
  ),
);
Container.displayName = "Container";
