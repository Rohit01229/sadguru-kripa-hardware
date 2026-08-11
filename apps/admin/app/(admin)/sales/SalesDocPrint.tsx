import type { SalesDocDTO } from "@hardware/core";
import { formatMoney, formatDate } from "@hardware/ui";

/**
 * The printable document. A server component — nothing here is interactive.
 *
 * Deliberately NOT the invoice template. A tax invoice must carry the shop's GSTIN,
 * the CGST/SGST-vs-IGST breakup and the words "Tax Invoice"; printing those on a
 * quotation would produce a document that looks like a claimable tax invoice while
 * carrying no invoice number. So this template states plainly what it is, and the
 * heading changes with the document kind rather than being configurable.
 */
export function SalesDocPrint({
  doc,
  store,
}: {
  doc: SalesDocDTO;
  store: { name: string; address: string | null; gstin: string | null; invoiceTerms: string | null };
}) {
  const heading =
    doc.kind === "QUOTATION"
      ? "ESTIMATE / QUOTATION"
      : doc.kind === "PROFORMA"
        ? "PROFORMA INVOICE"
        : "DELIVERY CHALLAN";

  return (
    <div className="text-sm">
      {/* ── Letterhead ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <div className="text-lg font-semibold">{store.name}</div>
          {store.address && (
            <div className="whitespace-pre-line text-xs text-muted-foreground">{store.address}</div>
          )}
          {store.gstin && <div className="text-xs text-muted-foreground">GSTIN: {store.gstin}</div>}
        </div>
        <div className="text-right">
          <div className="font-semibold tracking-wide">{heading}</div>
          <div className="text-xs text-muted-foreground">{doc.docNo}</div>
          <div className="text-xs text-muted-foreground">{formatDate(doc.date)}</div>
        </div>
      </div>

      {/* ── Party ── */}
      <div className="flex flex-wrap justify-between gap-4 border-b py-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {doc.kind === "DELIVERY_CHALLAN" ? "Deliver to" : "For"}
          </div>
          <div className="font-medium">{doc.customerName ?? "Walk-in customer"}</div>
          {doc.customerPhone && <div className="text-xs">{doc.customerPhone}</div>}
          {doc.customerGstin && <div className="text-xs">GSTIN: {doc.customerGstin}</div>}
        </div>
        {doc.validUntil && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Valid till</div>
            <div className="font-medium">{formatDate(doc.validUntil)}</div>
          </div>
        )}
      </div>

      {/* ── Lines ── */}
      <div className="overflow-x-auto py-4">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 text-left font-medium">#</th>
              <th className="py-2 text-left font-medium">Item</th>
              <th className="py-2 text-left font-medium">HSN</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              <th className="py-2 text-right font-medium">GST</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={`${l.productId}-${l.saleUnitId}-${i}`} className="border-b last:border-0">
                <td className="py-2 text-muted-foreground">{i + 1}</td>
                <td className="py-2">{l.productName}</td>
                <td className="py-2 text-xs text-muted-foreground">{l.hsnCode ?? "—"}</td>
                <td className="py-2 text-right tabular-nums">
                  {l.saleQty} {l.unitCode}
                </td>
                <td className="py-2 text-right tabular-nums">{formatMoney(l.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">{l.gstRatePct}%</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Totals ── */}
      <div className="flex justify-end border-t pt-4">
        <dl className="w-full max-w-xs space-y-1.5">
          <TotalRow k="Taxable" v={formatMoney(doc.taxableTotal)} />
          {doc.discountTotal > 0 && (
            <TotalRow k="Discount" v={`− ${formatMoney(doc.discountTotal)}`} />
          )}
          {doc.taxKind === "CGST_SGST" ? (
            <>
              <TotalRow k="CGST" v={formatMoney(doc.cgstTotal)} />
              <TotalRow k="SGST" v={formatMoney(doc.sgstTotal)} />
            </>
          ) : (
            <TotalRow k="IGST" v={formatMoney(doc.igstTotal)} />
          )}
          {doc.roundOff !== 0 && <TotalRow k="Round off" v={formatMoney(doc.roundOff)} />}
          <div className="flex items-baseline justify-between border-t pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(doc.grandTotal)}</dd>
          </div>
        </dl>
      </div>

      {doc.notes && (
        <div className="border-t pt-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
          <p className="whitespace-pre-line">{doc.notes}</p>
        </div>
      )}

      {store.invoiceTerms && (
        <div className="border-t pt-4 text-xs text-muted-foreground">
          <div className="uppercase tracking-wide">Terms</div>
          <p className="whitespace-pre-line">{store.invoiceTerms}</p>
        </div>
      )}

      {/* The disclaimer is not decoration: it is what stops this being mistaken for a
          tax invoice by a customer's accountant. */}
      <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
        {doc.kind === "DELIVERY_CHALLAN"
          ? "This is a delivery challan, not a tax invoice. A tax invoice will follow."
          : "This is not a tax invoice. Prices and taxes shown are an estimate; a GST invoice will be issued on sale."}
      </p>
    </div>
  );
}

function TotalRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
