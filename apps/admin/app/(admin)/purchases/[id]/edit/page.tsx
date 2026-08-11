import { redirect, notFound } from "next/navigation";
import {
  getPurchaseOrder,
  listPurchaseCatalog,
  listSuppliers,
  requirePermission,
  Forbidden,
} from "@hardware/core";
import { PageHeader, Alert, ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../../lib/session";
import { StockNav } from "../../../stock/nav";
import { PurchaseOrderForm } from "../../PurchaseOrderForm";

// Only an OPEN order is editable — once goods are received it is the record of what
// was ordered, and the core service refuses the write regardless of what renders here.
export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.grn");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="stock.grn" />;
    throw e;
  }

  const shopId = await requireShopId();
  const order = await getPurchaseOrder(shopId, id);
  if (!order) notFound();

  if (order.status !== "OPEN") {
    return (
      <div className="space-y-6">
        <StockNav active="purchases" />
        <PageHeader title={`Order ${order.poNo}`} />
        <Alert variant="destructive">
          {order.status === "RECEIVED"
            ? "Goods have already been received against this order, so it can no longer be changed."
            : "This order is cancelled, so it can no longer be changed."}
        </Alert>
      </div>
    );
  }

  const [products, suppliers] = await Promise.all([
    listPurchaseCatalog(shopId),
    listSuppliers(shopId),
  ]);

  return (
    <div className="space-y-6">
      <StockNav active="purchases" />
      <PageHeader title={`Edit order ${order.poNo}`} />
      <PurchaseOrderForm
        products={products}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        existing={order}
      />
    </div>
  );
}
