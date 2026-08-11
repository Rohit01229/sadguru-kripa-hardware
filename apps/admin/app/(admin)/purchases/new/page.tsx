import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listPurchaseCatalog,
  listSuppliers,
  requirePermission,
  Forbidden,
} from "@hardware/core";
import { PageHeader, Button, EmptyState, ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { StockNav } from "../../stock/nav";
import { PurchaseOrderForm } from "../PurchaseOrderForm";

export default async function NewPurchaseOrderPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.grn");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="stock.grn" />;
    throw e;
  }

  const shopId = await requireShopId();
  const [products, suppliers] = await Promise.all([
    listPurchaseCatalog(shopId),
    listSuppliers(shopId),
  ]);

  return (
    <div className="space-y-6">
      <StockNav active="purchases" />
      <PageHeader title="New purchase order" />
      {products.length === 0 ? (
        <EmptyState
          title="Add an item first"
          description="You need at least one item in your catalog before you can order it."
          action={
            <Button asChild>
              <Link href="/catalog/new">Add an item</Link>
            </Button>
          }
        />
      ) : (
        <PurchaseOrderForm
          products={products}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}
    </div>
  );
}
