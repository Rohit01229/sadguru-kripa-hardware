import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listProducts, requirePermission, Forbidden } from "@hardware/core";
import { PageHeader, EmptyState, Button, ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { LabelSheetBuilder, type LabelProduct } from "./LabelSheet";

// Barcode labels (19 §12; products.read). Build a printable sheet of shelf/stock labels
// for any items in the catalog. Read-only — printing a label changes no data.
export default async function LabelsPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "products.read");
  } catch (e) {
    if (e instanceof Forbidden) {
      return (
        <div className="space-y-6">
          <ForbiddenState perm="products.read" />
        </div>
      );
    }
    throw e;
  }

  const t = await getTranslations("catalog");
  const tc = await getTranslations("common");
  const shopId = await requireShopId();
  // 200 is the catalog schema's page ceiling; the in-page search filters this set.
  const page = await listProducts(shopId, { limit: 200 });

  const products: LabelProduct[] = page.data.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    price: p.saleUnits.find((su) => su.isDefault)?.salePrice ?? p.saleUnits[0]?.salePrice ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={t("labels.title")}
          description={t("labels.description")}
          breadcrumbs={[{ label: tc("nav.catalog"), href: "/catalog" }, { label: t("labels.breadcrumb") }]}
          linkComponent={Link}
        />
      </div>

      {products.length === 0 ? (
        <EmptyState
          title={t("labels.emptyTitle")}
          description={t("labels.emptyDescription")}
          action={
            <Button asChild>
              <Link href="/catalog/new">{t("labels.addItem")}</Link>
            </Button>
          }
        />
      ) : (
        <LabelSheetBuilder products={products} />
      )}
    </div>
  );
}
