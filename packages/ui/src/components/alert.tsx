import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon } from "./icons";

// Inline status banner (§4.3/§4.4). The semantic replacement for the raw-palette
// `bg-amber-50/text-amber-800`, `bg-red-50/text-red-700`, `bg-green-50/text-green-700`
// banners scattered across the storefront (orders/auth/verify/reset) and admin
// (POS, stock, movements). Tints come from the semantic --success/--warning/--info
// surface tokens (mapped in tailwind.preset.ts) and the existing --destructive var —
// so this is the ONLY presentation surface where status color lives, alongside Badge.
const alertVariants = cva(
  "relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        info: "border-info/20 bg-info/10 text-info dark:text-info",
        success: "border-success/20 bg-success/10 text-success dark:text-success",
        warning: "border-warning/30 bg-warning/10 text-warning dark:text-warning",
        destructive:
          "border-destructive/20 bg-destructive/10 text-destructive dark:text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

// Default leading icon per variant (16px, inherits the variant text color).
const defaultIcon: Record<NonNullable<AlertProps["variant"]>, React.ReactNode> = {
  default: <InfoIcon />,
  info: <InfoIcon />,
  success: <CheckCircleIcon />,
  warning: <AlertTriangleIcon />,
  destructive: <AlertTriangleIcon />,
};

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  /** Bold lead line. Optional — an Alert can be description-only. */
  title?: React.ReactNode;
  /** Body / explanation under the title. */
  description?: React.ReactNode;
  /**
   * Leading icon. Defaults to a sensible per-variant glyph; pass `null` to omit,
   * or a node to override. The icon is decorative — meaning is carried by text.
   */
  icon?: React.ReactNode;
}

/**
 * Status banner with `role="alert"`. Color is never the sole signal — the title /
 * description text carries the meaning and the icon is `aria-hidden`. Use for inline
 * mutation results that should persist on the page (toasts are for transient feedback).
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, title, description, icon, children, ...props }, ref) => {
    const resolvedIcon = icon === undefined ? defaultIcon[variant ?? "default"] : icon;
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {resolvedIcon ? (
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {resolvedIcon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          {title ? <p className="font-medium leading-tight">{title}</p> : null}
          {description ? (
            <div className="text-sm leading-snug opacity-90">{description}</div>
          ) : null}
          {children}
        </div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

export { alertVariants };
