import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  getSalesDoc,
  getStoreConfig,
  SALES_DOC_BY_SLUG,
  SALES_DOC_META,
  requirePermission,
  Forbidden,
  can,
} from "@hardware/core";
import {
  PageHeader,
  Button,
  Card,
  CardContent,
  Alert,
  ForbiddenState,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../../lib/session";
import { SalesNav, SalesDocStatusBadge } from "../../nav";
import { SalesDocActions } from "../../SalesDocActions";
import { SalesDocPrint } from "../../SalesDocPrint";

// One estimate / proforma / challan: the printable document plus the three things a
// shopkeeper does next — send it, bill it, or cancel it.
export default async function SalesDocDetailPage({
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
    requirePermission(session, "bill.read");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="bill.read" />;
    throw e;
  }

  const shopId = await requireShopId();
  const [doc, store] = await Promise.all([getSalesDoc(shopId, id), getStoreConfig(shopId)]);
  if (!doc || doc.kind !== kind) notFound();

  const meta = SALES_DOC_META[kind];
  const mayWrite = can(session, "bill.pakka.create");

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <SalesNav active={slug} />
      </div>

      <div className="print:hidden">
        <PageHeader
          title={`${meta.label} ${doc.docNo}`}
          description={
            doc.customerName
              ? `For ${doc.customerName}${doc.customerPhone ? ` · ${doc.customerPhone}` : ""}`
              : "Walk-in customer"
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <SalesDocStatusBadge status={doc.status} expired={doc.isExpired} />
              <Button asChild variant="ghost" size="sm">
                <Link href={`/sales/${slug}`}>Back</Link>
              </Button>
            </div>
          }
        />
      </div>

      {doc.status === "CONVERTED" && doc.convertedInvoiceId && (
        <Alert className="print:hidden">
          Billed on {doc.convertedAt ? formatDate(doc.convertedAt) : "—"} —{" "}
          <Link
            href={`/billing/invoices/${doc.convertedInvoiceId}`}
            className="font-medium underline"
          >
            open the bill
          </Link>
        </Alert>
      )}
      {doc.status === "CANCELLED" && (
        <Alert variant="destructive" className="print:hidden">
          Cancelled{doc.cancelledReason ? ` — ${doc.cancelledReason}` : ""}
        </Alert>
      )}
      {doc.status === "OPEN" && doc.isExpired && (
        <Alert className="print:hidden">
          This estimate was only valid until {formatDate(doc.validUntil!)}. Prices may have moved —
          edit it before you bill it.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="print:border-0 print:shadow-none">
          <CardContent className="pt-6 print:p-0">
            <SalesDocPrint
              doc={doc}
              store={{
                name: store?.name ?? "My Hardware Store",
                address: store?.address ?? null,
                gstin: store?.gstin ?? null,
                invoiceTerms: store?.invoiceTerms ?? null,
              }}
            />
          </CardContent>
        </Card>

        <aside className="space-y-3 print:hidden">
          <SalesDocActions doc={doc} slug={slug} storeName={store?.name ?? "My Hardware Store"} mayWrite={mayWrite} />
          <Card>
            <CardContent className="space-y-1.5 pt-6 text-sm">
              <Row k="Date" v={formatDate(doc.date)} />
              {doc.validUntil && <Row k="Valid till" v={formatDate(doc.validUntil)} />}
              <Row k="Items" v={String(doc.lines.length)} />
              <Row k="Total" v={formatMoney(doc.grandTotal)} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}
