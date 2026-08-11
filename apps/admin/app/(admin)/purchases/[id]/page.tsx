import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  getPurchaseOrder,
  getStoreConfig,
  requirePermission,
  Forbidden,
  can,
} from "@hardware/core";
import {
  PageHeader,
  Button,
  Card,
  CardContent,
  Alert,
  ForbiddenState,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { StockNav } from "../../stock/nav";
import { PurchaseOrderStatusBadge } from "../nav";
import { PurchaseOrderActions } from "../PurchaseOrderActions";

// One purchase order: the printable document a supplier can be handed, plus the three
// things a shopkeeper does next — receive it, revise it, or cancel it.
export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.read");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="stock.read" />;
    throw e;
  }

  const shopId = await requireShopId();
  const [order, store] = await Promise.all([getPurchaseOrder(shopId, id), getStoreConfig(shopId)]);
  if (!order) notFound();

  const mayWrite = can(session, "stock.grn");

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <StockNav active="purchases" />
        <PageHeader
          title={`Order ${order.poNo}`}
          description={`To ${order.supplierName}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PurchaseOrderStatusBadge status={order.status} />
              <Button asChild variant="ghost" size="sm">
                <Link href="/purchases">Back</Link>
              </Button>
            </div>
          }
        />
      </div>

      {order.status === "RECEIVED" && (
        <Alert className="print:hidden">
          Goods received on {order.receivedAt ? formatDate(order.receivedAt) : "—"} —{" "}
          <Link href="/stock/movements" className="font-medium underline">
            see the stock movements
          </Link>
        </Alert>
      )}
      {order.status === "CANCELLED" && (
        <Alert variant="destructive" className="print:hidden">
          Cancelled{order.cancelledReason ? ` — ${order.cancelledReason}` : ""}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="print:border-0 print:shadow-none">
          <CardContent className="pt-6 text-sm print:p-0">
            {/* ── Letterhead ── */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
              <div>
                <div className="text-lg font-semibold">{store?.name ?? "My Hardware Store"}</div>
                {store?.address && (
                  <div className="whitespace-pre-line text-xs text-muted-foreground">
                    {store.address}
                  </div>
                )}
                {store?.gstin && (
                  <div className="text-xs text-muted-foreground">GSTIN: {store.gstin}</div>
                )}
              </div>
              <div className="text-right">
                <div className="font-semibold tracking-wide">PURCHASE ORDER</div>
                <div className="text-xs text-muted-foreground">{order.poNo}</div>
                <div className="text-xs text-muted-foreground">{formatDate(order.date)}</div>
              </div>
            </div>

            {/* ── Supplier ── */}
            <div className="flex flex-wrap justify-between gap-4 border-b py-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Order to
                </div>
                <div className="font-medium">{order.supplierName}</div>
              </div>
              {order.expectedDate && (
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Expected by
                  </div>
                  <div className="font-medium">{formatDate(order.expectedDate)}</div>
                </div>
              )}
            </div>

            {/* ── Lines ── */}
            <div className="overflow-x-auto py-4">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 text-left font-medium">#</th>
                    <th className="py-2 text-left font-medium">Item</th>
                    <th className="py-2 text-right font-medium">Qty</th>
                    <th className="py-2 text-right font-medium">Rate</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l, i) => (
                    <tr key={`${l.productId}-${i}`} className="border-b last:border-0">
                      <td className="py-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-2">
                        <div>{l.productName}</div>
                        <div className="text-xs text-muted-foreground">{l.productSku}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {l.quantity} {l.unitLabel}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(l.costPerUnit)}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end border-t pt-4">
              <div className="flex w-full max-w-xs items-baseline justify-between text-base font-semibold">
                <span>Order value</span>
                <span className="tabular-nums">{formatMoney(order.subtotal)}</span>
              </div>
            </div>

            {order.notes && (
              <div className="border-t pt-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
                <p className="whitespace-pre-line">{order.notes}</p>
              </div>
            )}

            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              This is a purchase order, not a payment. Rates are as agreed and exclude any taxes
              your invoice may add.
            </p>
          </CardContent>
        </Card>

        <aside className="space-y-3 print:hidden">
          <PurchaseOrderActions order={order} mayWrite={mayWrite} />
          <Card>
            <CardContent className="space-y-1.5 pt-6 text-sm">
              <Row k="Items" v={String(order.lines.length)} />
              <Row k="Value" v={formatMoney(order.subtotal)} />
              {order.expectedDate && <Row k="Expected" v={formatDate(order.expectedDate)} />}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}
