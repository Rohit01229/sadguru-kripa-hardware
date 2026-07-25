import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listProducts, getStoreConfig, requirePermission, Forbidden, can } from "@hardware/core";
import { PageHeader, EmptyState, Button } from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { BillingNav, Forbid } from "./nav";
import { PosClient, type PosProduct } from "./PosClient";

// Counter POS (S4). Loads the active catalog (with sale units + GST rate + inclusive
// flag, for live totals) and the StoreConfig (home state = place-of-supply default,
// branding for print). Guarded on bill.kacha.create OR bill.pakka.create — the
// counter is usable by anyone who can ring up either kind of sale; each finalize is
// re-checked in core.
export default async function BillingPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  const t = await getTranslations("billing");

  const mayKacha = can(session, "bill.kacha.create");
  const mayPakka = can(session, "bill.pakka.create");
  if (!mayKacha && !mayPakka) {
    try {
      requirePermission(session, "bill.pakka.create");
    } catch (e) {
      if (e instanceof Forbidden) return <Forbid perm="bill.pakka.create / bill.kacha.create" />;
      throw e;
    }
  }

  // Khata billing needs a customer party for the receivable. The counter no longer
  // eagerly loads the WHOLE directory (the old listCustomers({ limit: 500 }) blew past
  // the ledger schema's .max(200) cap → ZodError, and even at 200 silently dropped
  // customers once a store grew past the cap). Instead the POS customer picker is a
  // typeahead that queries /api/customers?q= on demand (🔒 customers.read), so it scales
  // to any number of customers. We just pass the permission flag down to gate it.
  const mayReadCustomers = can(session, "customers.read");

  // The catalog seed for the counter. limit:200 is the catalog schema ceiling (a 500
  // here was the ZodError crash). This first page powers the empty-state check, the
  // initial search suggestions, and the cart line-label/preview map; the PosClient's
  // search box additionally queries /api/products?q= so the operator can ring up ANY
  // product, including ones past this first page.
  const [productPage, store] = await Promise.all([
    listProducts({ limit: 200 }),
    getStoreConfig(),
  ]);

  const products: PosProduct[] = productPage.data.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
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

  return (
    <div className="space-y-6">
      <BillingNav active="pos" />
      <PageHeader
        title={t("pos.title")}
        description={t.rich("pos.description", {
          kacha: (chunks) => <strong>{chunks}</strong>,
          pakka: (chunks) => <strong>{chunks}</strong>,
        })}
      />
      {products.length === 0 ? (
        <EmptyState
          title={t("pos.emptyTitle")}
          description={t("pos.emptyDescription")}
          action={
            <Button asChild variant="outline">
              <Link href="/catalog">{t("pos.goToCatalog")}</Link>
            </Button>
          }
        />
      ) : (
        <PosClient
          products={products}
          mayReadCustomers={mayReadCustomers}
          homeState={store?.homeState ?? "19"}
          storeName={store?.name ?? "My Hardware Store"}
          store={{
            name: store?.name ?? "My Hardware Store",
            address: store?.address ?? null,
            gstin: store?.gstin ?? null,
            bankDetails: store?.bankDetails ?? null,
            invoiceTerms: store?.invoiceTerms ?? null,
          }}
          mayKacha={mayKacha}
          mayPakka={mayPakka}
        />
      )}
    </div>
  );
}
