import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getInvoice, getStoreConfig, getProduct, requirePermission, DomainError } from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";
import { InvoiceDocument } from "../../../../../(admin)/billing/pdf/invoice-pdf";

// GET /api/billing/invoices/{id}/pdf (🔒S [bill.read]) — download the saved PAKKA tax
// invoice as an A4 PDF. Rendered server-side with @react-pdf/renderer (no Chromium →
// Vercel Hobby-safe). Node runtime required (react-pdf uses Node streams).
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "bill.read");

    const { id } = await params;
    const [invoice, store] = await Promise.all([getInvoice(id), getStoreConfig()]);
    if (!invoice) throw new DomainError(`Invoice ${id} not found`, "NOT_FOUND");

    // Resolve human item/unit names (the DTO carries only ids), same as the detail page.
    const productIds = [...new Set(invoice.lines.map((l) => l.productId))];
    const products = await Promise.all(productIds.map((pid) => getProduct(pid)));
    const pmap = new Map(products.filter(Boolean).map((p) => [p!.id, p!]));
    const lineNames: Record<string, string> = {};
    for (const l of invoice.lines) {
      const p = pmap.get(l.productId);
      const su = p?.saleUnits.find((x) => x.id === l.saleUnitId);
      const name = p?.name ?? l.productId;
      const unit = su?.unitName ?? su?.unitCode ?? "";
      lineNames[`${l.productId}::${l.saleUnitId}`] = unit ? `${name} (${unit})` : name;
    }

    // Call the component directly — it returns the react-pdf <Document> element that
    // renderToBuffer expects (no hooks in this component, so this is safe).
    const buffer = await renderToBuffer(
      InvoiceDocument({
        invoice,
        store: {
          name: store?.name ?? "My Hardware Store",
          address: store?.address ?? null,
          gstin: store?.gstin ?? null,
          bankDetails: store?.bankDetails ?? null,
          invoiceTerms: store?.invoiceTerms ?? null,
        },
        lineNames,
      }),
    );

    const safeNo = invoice.invoiceNo.replace(/[^\w.-]+/g, "_");
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // inline so the browser opens it in a tab; the client link adds download=…
        "Content-Disposition": `inline; filename="Invoice-${safeNo}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
