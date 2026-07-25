import type { BadgeProps } from "@hardware/ui";

// Order-status presentation map (design-system §6). Maps the underlying enum values
// to a shared Badge variant — the enum values themselves are NOT renamed; this is
// display-only. Kept in the orders screen area (not packages/ui) since it is specific
// to this queue. Human labels are localized at the render site via t('orders.status.*')
// and t('orders.payment.*').

type Variant = NonNullable<BadgeProps["variant"]>;

export const ORDER_STATUS_VARIANT: Record<string, Variant> = {
  PENDING_PAYMENT: "warning", // awaiting payment
  PAY_LATER: "info", // pay at store
  CONFIRMED: "info", // accepted, in queue
  PACKED: "info", // progressing
  DISPATCHED: "info", // out for delivery
  COMPLETED: "success", // done
  CANCELLED: "destructive",
};

// Payment status (order.paymentStatus). Neutral-ish pills; PAID reads as success,
// REFUNDED as a warning so a reversed order stands out.
export const PAYMENT_STATUS_VARIANT: Record<string, Variant> = {
  UNPAID: "outline",
  PARTIAL: "warning",
  PAID: "success",
  REFUNDED: "warning",
};

export function statusVariant(status: string): Variant {
  return ORDER_STATUS_VARIANT[status] ?? "default";
}

export function paymentVariant(status: string): Variant {
  return PAYMENT_STATUS_VARIANT[status] ?? "outline";
}
