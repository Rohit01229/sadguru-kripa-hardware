import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getInvoice,
  getStoreConfig,
  getBillTheme,
  getProduct,
  getCustomer,
  assessEwayBill,
  ewayValidityDays,
  listCreditNotesForInvoice,
  requirePermission,
  can,
  Forbidden,
} from "@hardware/core";
import {
  PageHeader,
  Card,
  Badge,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../../lib/session";
import { BillingNav, Forbid } from "../../nav";
import { buildWhatsAppUrl } from "../../share";
import { ReprintClient } from "./ReprintClient";
import { EwayBillCard } from "./eway/EwayBillCard";
import { InvoiceActions, type LineLabel } from "./InvoiceActions";

// Invoice detail (S4 reprint + S5 corrections). Renders the saved pakka invoice with
// StoreConfig branding (thermal/A5/A4, on-demand), plus the cancel + credit-note
// actions. bill.read guarded; cancel needs bill.cancel (owner-only), credit-note
// needs bill.creditnote.create — both re-checked in the core service.
export default async function InvoiceReprintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "bill.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="bill.read" />;
    throw e;
  }

  const t = await getTranslations("billing");
  const shopId = await requireShopId();
  const { id } = await params;
  const [invoice, store, creditNotes, billTheme] = await Promise.all([
    getInvoice(shopId, id),
    getStoreConfig(shopId),
    listCreditNotesForInvoice(shopId, id),
    getBillTheme(shopId),
  ]);
  if (!invoice) notFound();

  // Resolve human labels for the credit-note line picker (product + sale-unit names).
  const productIds = [...new Set(invoice.lines.map((l) => l.productId))];
  const products = await Promise.all(productIds.map((pid) => getProduct(shopId, pid)));
  const productMap = new Map(products.filter(Boolean).map((p) => [p!.id, p!]));
  const lineLabels: LineLabel[] = invoice.lines.map((l) => {
    const p = productMap.get(l.productId);
    const su = p?.saleUnits.find((s) => s.id === l.saleUnitId);
    const name = p?.name ?? l.productId;
    const unit = su?.unitName ?? su?.unitCode ?? l.saleUnitId;
    return { productId: l.productId, saleUnitId: l.saleUnitId, label: `${name} — ${unit}`, saleQty: l.saleQty };
  });

  // The party's phone, so "Send on WhatsApp" opens their chat directly. A walk-in bill
  // has no customer — WhatsApp then asks the operator to pick a contact, which is right.
  const billedTo =
    invoice.customerId && can(session, "customers.read")
      ? await getCustomer(shopId, invoice.customerId)
      : null;

  // e-Way bill (doc 20 §7) — needed for consignments above the state threshold, at any
  // turnover. Assessment is read-only, so it is safe to run on every view.
  const eway = await assessEwayBill(shopId, id);

  const canCancel = can(session, "bill.cancel");
  const canCredit = can(session, "bill.creditnote.create");

  return (
    <div className="space-y-6">
      <BillingNav active="invoices" />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {invoice.invoiceNo}
            {invoice.status === "CANCELLED" && <Badge variant="destructive">{t("detail.badgeCancelled")}</Badge>}
            {invoice.convertedFromKacha && <Badge variant="outline">{t("detail.badgeConverted")}</Badge>}
          </span>
        }
        description={`${formatDate(invoice.date)} · ${invoice.customerName ?? t("detail.descWalkIn")} · ${
          invoice.taxKind === "IGST" ? "IGST" : "CGST/SGST"
        }`}
        actions={
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("detail.grandTotal")}</div>
            <div className="text-lg font-semibold tabular-nums">{formatMoney(invoice.grandTotal)}</div>
          </div>
        }
      />

      <InvoiceActions invoice={invoice} lineLabels={lineLabels} canCancel={canCancel} canCredit={canCredit} />

      {creditNotes.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("detail.creditNotesHeading")}</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("detail.cnColNo")}</TableHead>
                  <TableHead>{t("detail.cnColDate")}</TableHead>
                  <TableHead>{t("detail.cnColRefund")}</TableHead>
                  <TableHead numeric>{t("detail.cnColAmount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditNotes.map((cn) => (
                  <TableRow key={cn.id}>
                    <TableCell className="font-medium">{cn.creditNoteNo}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(cn.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{cn.refundMode}</Badge>
                    </TableCell>
                    <TableCell numeric>{formatMoney(cn.grandTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <EwayBillCard
        invoiceId={id}
        assessment={eway}
        validityDays={ewayValidityDays(eway.existing?.distanceKm ?? null, eway.existing?.overDimensional ?? false)}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("detail.reprintHeading")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Re-send an old bill on WhatsApp — the commonest "can you send that again?"
                request at a counter (19 §5). */}
            <Button asChild size="sm">
              <a
                href={buildWhatsAppUrl(
                  {
                    invoiceNo: invoice.invoiceNo,
                    grandTotal: invoice.grandTotal,
                    date: invoice.date,
                    lines: invoice.lines.map((l) => ({
                      name:
                        lineLabels.find(
                          (x) => x.productId === l.productId && x.saleUnitId === l.saleUnitId,
                        )?.label ?? l.productId.slice(0, 8),
                      qty: l.saleQty,
                      amount: l.taxableValue + l.cgst + l.sgst + l.igst,
                    })),
                  },
                  store?.name ?? "My Hardware Store",
                  billedTo?.phone ?? null,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("pos.sendWhatsApp")}
              </a>
            </Button>
            {/* Server-generated A4 PDF (react-pdf). Opens in a new tab; save/print/email from there. */}
            <Button asChild variant="outline" size="sm">
              <a href={`/api/billing/invoices/${id}/pdf`} target="_blank" rel="noopener noreferrer">
                {t("pos.downloadPdf")}
              </a>
            </Button>
          </div>
        </div>
        <ReprintClient
          invoice={invoice}
          theme={billTheme}
          store={{
            name: store?.name ?? "My Hardware Store",
            address: store?.address ?? null,
            gstin: store?.gstin ?? null,
            bankDetails: store?.bankDetails ?? null,
            invoiceTerms: store?.invoiceTerms ?? null,
          }}
          lineLabels={lineLabels}
        />
      </section>
    </div>
  );
}
