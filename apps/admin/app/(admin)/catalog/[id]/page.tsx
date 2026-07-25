import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getProduct,
  listUnits,
  listPriceSlabs,
  requirePermission,
  Forbidden,
} from "@hardware/core";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ForbiddenState,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
  formatQty,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { PriceSlabEditor } from "./PriceSlabEditor";
import { AddSaleUnitForm, ArchiveButton } from "./ProductActions";
import { ProductImagesCard } from "./ProductImagesCard";

// Product detail / edit (S2): shows attributes, sale units (UoM), price slabs
// editor, add-sale-unit, archive/restore. Guarded products.read; mutations guard
// products.update / pricing.write in core.
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  const units = await listUnits();
  // Load slabs per sale unit for the editor's initial state.
  const slabEntries = await Promise.all(
    product.saleUnits.map(async (su) => [su.id, await listPriceSlabs(su.id)] as const),
  );
  const initialSlabs: Record<string, { minQty: string; pricePerSaleUnit: number }[]> = {};
  for (const [suId, slabs] of slabEntries) {
    initialSlabs[suId] = slabs.map((s) => ({ minQty: s.minQty, pricePerSaleUnit: s.pricePerSaleUnit }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={t("detail.description", {
          sku: product.sku,
          hsn: product.hsnCode ?? "—",
          gst: product.gstRatePct,
        })}
        breadcrumbs={[{ label: tc("nav.catalog"), href: "/catalog" }, { label: product.name }]}
        linkComponent={Link}
        actions={
          <>
            {product.isActive ? (
              <Badge variant="success">{t("detail.statusActive")}</Badge>
            ) : (
              <Badge variant="default">{t("detail.statusArchived")}</Badge>
            )}
            <ArchiveButton productId={product.id} isActive={product.isActive} />
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("detail.statBaseUnit")} value={product.baseUnit.code} sub={product.baseUnit.kind} />
        <StatCard label={t("detail.statAvailable")} value={formatQty(product.availableBase)} />
        <StatCard label={t("detail.statCost")} value={formatMoney(product.costPerBaseUnit)} />
        <StatCard label={t("detail.statBrand")} value={product.brand ?? "—"} />
      </section>

      <ProductImagesCard productId={product.id} initial={product.imageKeys} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("detail.sectionSaleUnits")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("detail.colUnit")}</TableHead>
                  <TableHead>{t("detail.colKind")}</TableHead>
                  <TableHead numeric>{t("detail.colFactor")}</TableHead>
                  <TableHead numeric>{t("detail.colSalePrice")}</TableHead>
                  <TableHead numeric>{t("detail.colMrp")}</TableHead>
                  <TableHead>{t("detail.colDefault")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.saleUnits.map((su) => (
                  <TableRow key={su.id}>
                    <TableCell className="font-medium">{su.unitCode}</TableCell>
                    <TableCell>
                      {su.unitKind === "PIECE" ? (
                        <Badge variant="outline">{t("detail.kindPiece")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("detail.kindMeasured")}</Badge>
                      )}
                    </TableCell>
                    <TableCell numeric>{formatQty(su.factorToBase, product.baseUnit.code)}</TableCell>
                    <TableCell numeric>{formatMoney(su.salePrice)}</TableCell>
                    <TableCell numeric>{su.mrp === null ? "—" : formatMoney(su.mrp)}</TableCell>
                    <TableCell>{su.isDefault ? <Badge variant="info">{t("detail.badgeDefault")}</Badge> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("detail.addSaleUnitHeading")}</p>
            <AddSaleUnitForm productId={product.id} units={units} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">{t("detail.sectionSlabs")}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("detail.slabsIntro")}
          </p>
        </CardHeader>
        <CardContent>
          <PriceSlabEditor
            productId={product.id}
            saleUnits={product.saleUnits.map((su) => ({ id: su.id, unitCode: su.unitCode }))}
            initial={initialSlabs}
          />
        </CardContent>
      </Card>
    </div>
  );
}
