import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listProducts, requirePermission, can, Forbidden } from "@hardware/core";
import { PageHeader, EmptyState } from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { StockNav, Forbid } from "../nav";
import { AdjustForm, ReturnForm } from "./StockForms";

// Adjustments & returns (S3): signed ADJUST_IN/OUT with a required reason, and
// sales/purchase returns. Negative-stock is blocked by default; an allow-negative
// toggle opts in (03 §5). Both forms post to the stock server actions, which
// enforce stock.adjust / stock.returns + audit.
export default async function AdjustmentsPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.adjust");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="stock.adjust" />;
    throw e;
  }

  const t = await getTranslations("stock");
  const productPage = await listProducts({ limit: 200 });
  const products = productPage.data.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    baseUnitCode: p.baseUnit.code,
    saleUnits: p.saleUnits.map((su) => ({ id: su.id, label: `${su.unitName} (×${su.factorToBase} ${p.baseUnit.code})` })),
  }));

  const canReturn = can(session, "stock.returns");

  return (
    <div className="space-y-6">
      <StockNav active="adjust" />

      <PageHeader
        title={t("adjust.title")}
        description={t("adjust.description")}
      />

      {products.length === 0 ? (
        <EmptyState
          title={t("adjust.emptyTitle")}
          description={t("adjust.emptyDescription")}
        />
      ) : (
        <div className="space-y-6">
          <AdjustForm products={products} />
          {canReturn && <ReturnForm products={products} />}
        </div>
      )}
    </div>
  );
}
