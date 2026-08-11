import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  listProducts,
  getStoreConfig,
  SALES_DOC_BY_SLUG,
  SALES_DOC_META,
  requirePermission,
  Forbidden,
} from "@hardware/core";
import { PageHeader, Button, EmptyState, ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../../lib/session";
import type { PosProduct } from "../../../billing/PosClient";
import { SalesNav } from "../../nav";
import { SalesDocForm } from "../../SalesDocForm";

// New estimate / proforma / delivery challan. Loads the same catalog page the counter
// does so the item search feels identical; the form additionally queries
// /api/products?q= so any item is reachable, not just this first page.
export default async function NewSalesDocPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const kind = SALES_DOC_BY_SLUG[slug];
  if (!kind) notFound();

  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "bill.pakka.create");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="bill.pakka.create" />;
    throw e;
  }

  const shopId = await requireShopId();
  const [productPage, store] = await Promise.all([
    listProducts(shopId, { limit: 200 }),
    getStoreConfig(shopId),
  ]);

  const products: PosProduct[] = productPage.data.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    gstRatePct: p.gstRatePct,
    priceInclusive: p.priceInclusive,
    hsnCode: p.hsnCode,
    baseUnitCode: p.baseUnit.code,
    availableBase: p.availableBase,
    saleUnits: p.saleUnits.map((su) => ({
      id: su.id,
      unitCode: su.unitCode,
      unitName: su.unitName,
      unitKind: su.unitKind,
      factorToBase: su.factorToBase,
      salePrice: su.salePrice,
      mrp: su.mrp,
      isDefault: su.isDefault,
    })),
  }));

  const meta = SALES_DOC_META[kind];

  return (
    <div className="space-y-6">
      <SalesNav active={slug} />
      <PageHeader title={`New ${meta.label.toLowerCase()}`} />
      {products.length === 0 ? (
        <EmptyState
          title="Add an item first"
          description="You need at least one item in your catalog before you can write this up."
          action={
            <Button asChild>
              <Link href="/catalog/new">Add an item</Link>
            </Button>
          }
        />
      ) : (
        <SalesDocForm kind={kind} products={products} homeState={store?.homeState ?? "19"} />
      )}
    </div>
  );
}
