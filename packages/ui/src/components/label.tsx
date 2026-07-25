import * as React from "react";
import { cn } from "../lib/cn";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders a muted required asterisk after the label text. */
  required?: boolean;
}

/** Form label. Pairs with a control via `htmlFor`. `required` adds a muted `*`. */
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-muted-foreground" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  ),
);
Label.displayName = "Label";
