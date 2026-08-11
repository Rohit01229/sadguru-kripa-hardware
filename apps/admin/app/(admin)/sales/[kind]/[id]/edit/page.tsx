import { redirect, notFound } from "next/navigation";
import {
  listProducts,
  getStoreConfig,
  getSalesDoc,
  SALES_DOC_BY_SLUG,
  SALES_DOC_META,
  requirePermission,
  Forbidden,
} from "@hardware/core";
import { PageHeader, Alert, ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../../../lib/session";
import type { PosProduct } from "../../../../billing/PosClient";
import { SalesNav } from "../../../nav";
import { SalesDocForm } from "../../../SalesDocForm";

// Revise an open document. Only OPEN documents are editable — once one has been
// converted it is the record of what was agreed before the bill, and the core service
// refuses the write regardless of what this page renders.
export default async function EditSalesDocPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind: slug, id } = await params;
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
  const doc = await getSalesDoc(shopId, id);
  if (!doc || doc.kind !== kind) notFound();

  const meta = SALES_DOC_META[kind];

  if (doc.status !== "OPEN") {
    return (
      <div className="space-y-6">
        <SalesNav active={slug} />
        <PageHeader title={`${meta.label} ${doc.docNo}`} />
        <Alert variant="destructive">
          {doc.status === "CONVERTED"
            ? "This has already been converted to a bill, so it can no longer be changed."
            : "This document is cancelled, so it can no longer be changed."}
        </Alert>
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      <SalesNav active={slug} />
      <PageHeader title={`Edit ${meta.label.toLowerCase()} ${doc.docNo}`} />
      <SalesDocForm
        kind={kind}
        products={products}
        homeState={store?.homeState ?? "19"}
        existing={doc}
      />
    </div>
  );
}
