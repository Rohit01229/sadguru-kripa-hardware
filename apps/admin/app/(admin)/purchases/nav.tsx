import { Badge } from "@hardware/ui";

// Shared purchase-order chrome. A route file may only export `default` + route config,
// so shared components live here (same pattern as billing/nav and sales/nav).

/**
 * Status pill for a purchase order. Deliberately says "Received" rather than "Closed":
 * what a shopkeeper wants to know is whether the goods turned up.
 */
export function PurchaseOrderStatusBadge({ status }: { status: string }) {
  if (status === "RECEIVED") return <Badge variant="success">Received</Badge>;
  if (status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="outline">Open</Badge>;
}
