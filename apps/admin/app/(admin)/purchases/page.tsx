import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listPurchaseOrders,
  purchaseOrderCounts,
  requirePermission,
  Forbidden,
  can,
} from "@hardware/core";
import {
  PageHeader,
  Button,
  Card,
  CardContent,
  EmptyState,
  ForbiddenState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../lib/session";
import { StockNav } from "../stock/nav";
import { PurchaseOrderStatusBadge } from "./nav";

// Purchase orders (21c) — what has been ordered and not yet arrived.
//
// Lives under the Stock section's nav rather than a twelfth sidebar entry: goods
// receipts and suppliers are already there, and purchasing split across two places is
// worse than purchasing one click deeper.
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.read");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="stock.read" />;
    throw e;
  }

  const shopId = await requireShopId();
  const sp = await searchParams;
  const status =
    sp.status === "OPEN" ||
    sp.status === "PARTIAL" ||
    sp.status === "RECEIVED" ||
    sp.status === "CANCELLED"
      ? sp.status
      : undefined;

  const [page, counts] = await Promise.all([
    listPurchaseOrders(shopId, { status, q: sp.q || undefined, limit: 100 }),
    purchaseOrderCounts(shopId),
  ]);
  const mayWrite = can(session, "stock.grn");

  const filters = [
    {
      key: "",
      label: "All",
      count: counts.open + counts.partial + counts.received + counts.cancelled,
      href: "/purchases",
    },
    { key: "OPEN", label: "Open", count: counts.open, href: "/purchases?status=OPEN" },
    {
      key: "PARTIAL",
      label: "Part received",
      count: counts.partial,
      href: "/purchases?status=PARTIAL",
    },
    { key: "RECEIVED", label: "Received", count: counts.received, href: "/purchases?status=RECEIVED" },
    {
      key: "CANCELLED",
      label: "Cancelled",
      count: counts.cancelled,
      href: "/purchases?status=CANCELLED",
    },
  ];

  return (
    <div className="space-y-6">
      <StockNav active="purchases" />
      <PageHeader
        title="Purchase orders"
        description="What you have asked suppliers to send. Receiving one books the stock in."
        actions={
          mayWrite ? (
            <Button asChild>
              <Link href="/purchases/new">New order</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f.key || "all"}
            asChild
            size="sm"
            variant={(status ?? "") === f.key ? "default" : "outline"}
          >
            <Link href={f.href}>
              {f.label} <span className="ml-1.5 tabular-nums opacity-70">{f.count}</span>
            </Link>
          </Button>
        ))}
      </div>

      {page.data.length === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          description="Raise one to record what you have ordered, then receive it when the goods arrive."
          action={
            mayWrite ? (
              <Button asChild>
                <Link href="/purchases/new">New order</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[44rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Order</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead numeric>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.data.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell>
                        <Link
                          href={`/purchases/${po.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {po.poNo}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {po.lines.length} item{po.lines.length === 1 ? "" : "s"}
                        </div>
                      </TableCell>
                      <TableCell>{po.supplierName}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(po.date)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {po.expectedDate ? formatDate(po.expectedDate) : "—"}
                      </TableCell>
                      <TableCell>
                        <PurchaseOrderStatusBadge status={po.status} />
                      </TableCell>
                      <TableCell numeric className="font-medium">
                        {formatMoney(po.subtotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
