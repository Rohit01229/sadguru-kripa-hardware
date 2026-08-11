import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listProducts,
  getProduct,
  getStoreConfig,
  getBillTheme,
  getSalesDoc,
  requirePermission,
  Forbidden,
  can,
} from "@hardware/core";
import { PageHeader, EmptyState, Button } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../lib/session";
import { BillingNav, Forbid } from "./nav";
import { PosClient, type PosProduct, type PosPrefill } from "./PosClient";

// Counter POS (S4). Loads the active catalog (with sale units + GST rate + inclusive
// flag, for live totals) and the StoreConfig (home state = place-of-supply default,
// branding for print). Guarded on bill.kacha.create OR bill.pakka.create — the
// counter is usable by anyone who can ring up either kind of sale; each finalize is
// re-checked in core.
export default async function BillingPage({
  searchParams,
}: {
  /** `?fromDoc=<id>` — billing an estimate / proforma / challan (21). */
  searchParams: Promise<{ fromDoc?: string }>;
}) {
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
  const shopId = await requireShopId();
  const [productPage, store, billTheme] = await Promise.all([
    listProducts(shopId, { limit: 200 }),
    getStoreConfig(shopId),
    getBillTheme(shopId),
  ]);

  const toPos = (p: (typeof productPage.data)[number]): PosProduct => ({
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
  });

  const products: PosProduct[] = productPage.data.map(toPos);

  // ── Billing an estimate / proforma / challan (21) ──
  // The document's lines are loaded into the cart so the operator can adjust before
  // finalising. Only an OPEN document prefills: a cancelled or already-billed one must
  // not quietly become a second bill. Its items may sit outside the first catalog page,
  // so any missing ones are fetched here — otherwise the cart would hold a line the
  // client cannot price or name.
  const { fromDoc } = await searchParams;
  let prefill: PosPrefill | undefined;
  if (fromDoc) {
    const doc = await getSalesDoc(shopId, fromDoc);
    if (doc && doc.status === "OPEN") {
      const known = new Set(products.map((p) => p.id));
      const missing = [...new Set(doc.lines.map((l) => l.productId))].filter((id) => !known.has(id));
      for (const id of missing) {
        const p = await getProduct(shopId, id);
        if (p) products.push(toPos(p));
      }
      prefill = {
        salesDocId: doc.id,
        docNo: doc.docNo,
        kindLabel: doc.kindLabel,
        placeOfSupplyState: doc.placeOfSupplyState,
        customer: doc.customerId
          ? {
              id: doc.customerId,
              name: doc.customerName ?? "",
              phone: doc.customerPhone,
              gstin: doc.customerGstin,
            }
          : null,
        customerName: doc.customerName,
        lines: doc.lines.map((l) => ({
          productId: l.productId,
          saleUnitId: l.saleUnitId,
          quantity: l.saleQty,
          rateOverride: l.unitPrice,
          lineDiscount: l.lineDiscount,
        })),
      };
    }
  }

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
          billTheme={billTheme}
          products={products}
          prefill={prefill}
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
