import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPublicProduct } from "@hardware/core";
import { Badge, Card, formatMoney, formatQty } from "@hardware/ui";
import { AddToCart } from "./AddToCart";
import { ProductGallery } from "./ProductGallery";

// Public product detail (S2 + S3 live stock): storefront-safe fields + sale-unit
// options + LIVE available stock (available = onHand − reserved, from
// ProductStock via the catalog projection — now reflects GRN/adjustments once S3
// moves stock). Cart/checkout land in S6 — this is the read-only browse page.
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("catalog");
  const product = await getPublicProduct(id);
  if (!product) notFound();

  const available = Number(product.availableBase);
  const inStock = available > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href="/"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
      >
        {t("detail.backToCatalog")}
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
        {/* Left: photo gallery (placeholder when the product has no images yet). */}
        <ProductGallery images={product.imageKeys} alt={product.name} />

        {/* Right: identity, stock, sale-unit prices, add-to-cart. */}
        <div className="min-w-0">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          {product.brand ? `${product.brand} · ` : ""}
          {t("detail.sku", { sku: product.sku })}
        </p>
      </div>

      <div className="mt-4">
        {inStock ? (
          <Badge variant="success">
            {t("stock.inStockWithQty", {
              qty: formatQty(product.availableBase, product.baseUnit.code),
            })}
          </Badge>
        ) : (
          <Badge variant="destructive">{t("stock.currentlyOutOfStock")}</Badge>
        )}
      </div>

      <section className="mt-6">
        <h2 className="text-base font-semibold">{t("detail.availableIn")}</h2>
        <Card className="mt-2 divide-y">
          {product.saleUnits.map((su) => (
            <div
              key={su.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {su.unitName} ({su.unitCode})
                </span>
                {su.unitKind === "PIECE" && <Badge variant="outline">{t("detail.wholeOnly")}</Badge>}
              </span>
              <span className="font-semibold tabular-nums">{formatMoney(su.salePrice)}</span>
            </div>
          ))}
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("detail.taxNote", { gst: product.gstRatePct, hsn: product.hsnCode ?? "—" })}
        </p>
      </section>

      <AddToCart
        productId={product.id}
        name={product.name}
        inStock={inStock}
        saleUnits={product.saleUnits.map((su) => ({
          id: su.id,
          unitCode: su.unitCode,
          unitName: su.unitName,
          unitKind: su.unitKind,
          salePrice: su.salePrice,
        }))}
      />
        </div>
      </div>
    </div>
  );
}
