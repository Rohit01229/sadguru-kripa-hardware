import type { BadgeProps } from "@hardware/ui";

// Storefront order-status presentation map (design-system §6). Maps the underlying
// order enum to a human label + a Badge variant. Display-only — the enum values
// themselves are never renamed.

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAY_LATER: "Pay at store",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  DISPATCHED: "Dispatched",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const ORDER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING_PAYMENT: "warning",
  PAY_LATER: "info",
  CONFIRMED: "info",
  PACKED: "info",
  DISPATCHED: "info",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

/** Human-readable order status label (falls back to a title-cased enum value). */
export function orderStatusLabel(status: string): string {
  return (
    ORDER_STATUS_LABEL[status] ??
    status
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** Badge variant for an order status (defaults to a neutral pill). */
export function orderStatusVariant(status: string): BadgeVariant {
  return ORDER_STATUS_VARIANT[status] ?? "outline";
}

const FULFILMENT_LABEL: Record<string, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  UNPAID: "Unpaid",
  REFUNDED: "Refunded",
};

/** Human-readable fulfilment label (falls back to a title-cased enum value). */
export function fulfilmentLabel(fulfilment: string): string {
  return FULFILMENT_LABEL[fulfilment] ?? titleCase(fulfilment);
}

/** Human-readable payment-status label (falls back to a title-cased enum value). */
export function paymentStatusLabel(paymentStatus: string): string {
  return PAYMENT_STATUS_LABEL[paymentStatus] ?? titleCase(paymentStatus);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
