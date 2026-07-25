import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listProducts, listSuppliers, requirePermission, Forbidden } from "@hardware/core";
import { PageHeader } from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { StockNav, Forbid } from "../nav";
import { GrnForm } from "./GrnForm";

// GRN entry (S3): supplier + lines (product · receive unit · qty · batch/expiry ·
// cost). Converts receive-unit qty → base and increments stock atomically; the
// core service enforces stock.grn + audits + is idempotent on the Idempotency-Key.
export default async function GrnPage() {
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
  const [productPage, suppliers] = await Promise.all([listProducts({ limit: 200 }), listSuppliers()]);
  const products = productPage.data.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    baseUnitCode: p.baseUnit.code,
    saleUnits: p.saleUnits.map((su) => ({ id: su.id, label: `${su.unitName} (×${su.factorToBase} ${p.baseUnit.code})` })),
  }));

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
      />
    </div>
  );
}
