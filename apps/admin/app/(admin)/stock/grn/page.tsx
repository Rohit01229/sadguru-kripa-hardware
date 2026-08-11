import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listProducts,
  listSuppliers,
  getPurchaseOrder,
  requirePermission,
  Forbidden,
} from "@hardware/core";
import { PageHeader } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { StockNav, Forbid } from "../nav";
import { GrnForm, type GrnPrefill } from "./GrnForm";

// GRN entry (S3): supplier + lines (product · receive unit · qty · batch/expiry ·
// cost). Converts receive-unit qty → base and increments stock atomically; the
// core service enforces stock.grn + audits + is idempotent on the Idempotency-Key.
export default async function GrnPage({
  searchParams,
}: {
  /** `?fromPo=<id>` — receiving against a purchase order (21c). */
  searchParams: Promise<{ fromPo?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.grn");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="stock.grn" />;
    throw e;
  }

  const t = await getTranslations("stock");

  // Load active products (with sale units, for the receive-unit picker) + suppliers.
  const shopId = await requireShopId();
  const [productPage, suppliers] = await Promise.all([listProducts(shopId, { limit: 200 }), listSuppliers(shopId)]);
  const products = productPage.data.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    baseUnitCode: p.baseUnit.code,
    saleUnits: p.saleUnits.map((su) => ({ id: su.id, label: `${su.unitName} (×${su.factorToBase} ${p.baseUnit.code})` })),
  }));

  // Receiving against a purchase order (21c). An order that is OPEN or PARTIAL can
  // still take goods; a cancelled or fully-received one must not quietly book more.
  //
  // The lines are seeded with what is OUTSTANDING, not what was originally ordered —
  // on the second lot of a part-delivered order, offering the full quantity again is
  // how stock gets double-counted.
  const { fromPo } = await searchParams;
  let prefill: GrnPrefill | undefined;
  if (fromPo) {
    const po = await getPurchaseOrder(shopId, fromPo);
    if (po && (po.status === "OPEN" || po.status === "PARTIAL")) {
      const outstanding = po.lines.filter((l) => Number(l.remainingQty) > 0);
      if (outstanding.length > 0) {
        prefill = {
          purchaseOrderId: po.id,
          poNo: po.poNo,
          supplierId: po.supplierId,
          isPartial: po.status === "PARTIAL",
          lines: outstanding.map((l) => ({
            productId: l.productId,
            receiveUnitId: l.receiveUnitId,
            quantity: l.remainingQty,
            costPerUnit: l.costPerUnit,
          })),
        };
      }
    }
  }

  return (
    <div className="space-y-6">
      <StockNav active="grn" />

      <PageHeader
        title={t("grn.title")}
        description={t("grn.description")}
      />

      <GrnForm
        products={products}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        prefill={prefill}
      />
    </div>
  );
}
