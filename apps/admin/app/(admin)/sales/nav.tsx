import Link from "next/link";
import { Badge, Tabs, TabsList, TabsLink } from "@hardware/ui";
import type { SalesDocKind } from "@hardware/core";

// Sub-nav for the pre-sale documents (21), matching myBillBook's "Sales" group order:
// the bill first, then the papers that lead up to it. A route file may only export
// `default` + route config, so shared chrome lives here (same pattern as billing/nav).

export const SALES_TABS = [
  { href: "/billing", label: "Bills", key: "pos" },
  { href: "/billing/invoices", label: "Bill history", key: "invoices" },
  { href: "/sales/estimates", label: "Estimates", key: "estimates" },
  { href: "/sales/proforma", label: "Proforma", key: "proforma" },
  { href: "/sales/challans", label: "Delivery challans", key: "challans" },
] as const;

export function SalesNav({ active }: { active: string }) {
  return (
    <Tabs value={active}>
      <TabsList>
        {SALES_TABS.map((i) => (
          <TabsLink key={i.key} active={i.key === active}>
            <Link href={i.href}>{i.label}</Link>
          </TabsLink>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** One-line explanation of what each document is for, in shopkeeper terms. */
export const SALES_DOC_DESCRIPTION: Record<SalesDocKind, string> = {
  QUOTATION:
    "Price offers you have given. Convert one to a bill when the customer says yes — nothing is billed until then.",
  PROFORMA: "Requests for advance payment. Not a tax invoice, so no GST is claimed on them.",
  DELIVERY_CHALLAN:
    "Goods sent out ahead of the bill. Convert to a bill once the sale is confirmed.",
};

/**
 * Status pill. "Expired" is derived from the validity date, not stored — a quotation
 * does not become a different thing at midnight, it just stops being worth honouring.
 */
export function SalesDocStatusBadge({ status, expired }: { status: string; expired?: boolean }) {
  if (status === "CONVERTED") return <Badge variant="success">Billed</Badge>;
  if (status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  if (expired) return <Badge variant="outline">Expired</Badge>;
  return <Badge variant="outline">Open</Badge>;
}
