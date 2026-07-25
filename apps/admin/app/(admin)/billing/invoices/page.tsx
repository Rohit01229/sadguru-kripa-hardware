import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listInvoices, getCustomer, requirePermission, can, Forbidden } from "@hardware/core";
import {
  PageHeader,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  EmptyState,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { BillingNav, Forbid } from "../nav";
import { InvoiceFilterBar } from "./InvoiceFilterBar";

// Invoice day-book (S4): list pakka invoices for reprint. bill.read guarded. Kacha
// sales intentionally do NOT appear here (zero-trace — no bill row exists, 03 §6).
// Filters (status / date range / customer) are SERVER-SIDE: URL search params feed the
// new optional listInvoices() params → SQL. Mirrors the catalog/audit filter pattern.
const STATUSES = ["ACTIVE", "CANCELLED"] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    from?: string;
    to?: string;
    customerId?: string;
    cursor?: string;
  }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "bill.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="bill.read" />;
    throw e;
  }

  const t = await getTranslations("billing");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as (typeof STATUSES)[number])
    : undefined;

  const mayBill = can(session, "bill.kacha.create") || can(session, "bill.pakka.create");
  // The customer filter dropdown only renders when the user may read customers — the
  // ledger guard. Without it, the other filters still work (status/date are unguarded).
  const mayReadCustomers = can(session, "customers.read");

  // The customer filter is a typeahead (it queries /api/customers?q= on demand), so we
  // no longer eagerly load the whole directory here — that was the limit:500 ZodError
  // crash and silently dropped customers past the cap. We only resolve the ONE already-
  // selected customer (if any) so the picker can show its name on reload.
  const [page, selectedCustomer] = await Promise.all([
    listInvoices({
      status,
      from: sp.from || undefined,
      to: sp.to || undefined,
      customerId: sp.customerId || undefined,
      cursor: sp.cursor,
      limit: 50,
    }),
    mayReadCustomers && sp.customerId ? getCustomer(sp.customerId) : Promise.resolve(null),
  ]);

  const hasFilters = Boolean(status || sp.from || sp.to || sp.customerId);

  // Preserve active filters when paginating (cursor is replaced, not appended).
  const qs = (cursor: string) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (sp.from) p.set("from", sp.from);
    if (sp.to) p.set("to", sp.to);
    if (sp.customerId) p.set("customerId", sp.customerId);
    p.set("cursor", cursor);
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <BillingNav active="invoices" />
      <PageHeader
        title={t("invoices.title")}
        description={t("invoices.description")}
        actions={
          mayBill ? (
            <Button asChild>
              <Link href="/billing">{t("invoices.newInvoice")}</Link>
            </Button>
          ) : undefined
        }
      />

      {/* Server-side filter bar. Extracted to a client component that intercepts submit
          for no-reload navigation; method="get" stays as the no-JS fallback. The
          CustomerFilter hidden customerId input is carried through by FormData. */}
      <InvoiceFilterBar
        status={status ?? ""}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
        initialCustomerId={selectedCustomer?.id ?? ""}
        initialName={selectedCustomer?.name ?? ""}
        mayReadCustomers={mayReadCustomers}
        hasFilters={hasFilters}
      />

      {page.data.length === 0 ? (
        <EmptyState
          title={hasFilters ? t("invoices.emptyFilteredTitle") : t("invoices.emptyTitle")}
          description={hasFilters ? t("invoices.emptyFilteredDescription") : t("invoices.emptyDescription")}
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link href="/billing/invoices">{t("invoices.clearFilters")}</Link>
              </Button>
            ) : mayBill ? (
              <Button asChild>
                <Link href="/billing">{t("invoices.openCounter")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile (<sm): stacked cards — no horizontal scroll, tap target is the whole row. */}
          <ul className="space-y-3 sm:hidden">
            {page.data.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/billing/invoices/${inv.id}`}
                  className="block rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{inv.invoiceNo}</div>
                      <div className="text-sm text-muted-foreground">
                        {inv.customerName ?? t("invoices.walkIn")}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold tabular-nums">{formatMoney(inv.grandTotal)}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(inv.date)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {inv.status === "CANCELLED" ? (
                      <Badge variant="destructive">{t("invoices.statusCancelled")}</Badge>
                    ) : (
                      <Badge variant="success">{t("invoices.statusActive")}</Badge>
                    )}
                    <Badge variant="outline">{inv.taxKind === "IGST" ? "IGST" : "CGST/SGST"}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop (>=sm): full day-book table. */}
          <div className="hidden overflow-x-auto rounded-lg border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.colInvoiceNo")}</TableHead>
                  <TableHead>{t("invoices.colDate")}</TableHead>
                  <TableHead>{t("invoices.colCustomer")}</TableHead>
                  <TableHead>{t("invoices.colTax")}</TableHead>
                  <TableHead>{t("invoices.colStatus")}</TableHead>
                  <TableHead numeric>{t("invoices.colGrandTotal")}</TableHead>
                  <TableHead className="sr-only">{t("invoices.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.data.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link
                        href={`/billing/invoices/${inv.id}`}
                        className="font-medium hover:underline"
                      >
                        {inv.invoiceNo}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(inv.date)}</TableCell>
                    <TableCell>{inv.customerName ?? t("invoices.walkIn")}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{inv.taxKind === "IGST" ? "IGST" : "CGST/SGST"}</Badge>
                    </TableCell>
                    <TableCell>
                      {inv.status === "CANCELLED" ? (
                        <Badge variant="destructive">{t("invoices.statusCancelled")}</Badge>
                      ) : (
                        <Badge variant="success">{t("invoices.statusActive")}</Badge>
                      )}
                    </TableCell>
                    <TableCell numeric className="font-medium">
                      {formatMoney(inv.grandTotal)}
                    </TableCell>
                    <TableCell numeric>
                      <Link
                        href={`/billing/invoices/${inv.id}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t("invoices.reprint")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {page.pageInfo.hasNextPage && page.pageInfo.nextCursor && (
        <div className="flex justify-end">
          <Button asChild variant="outline">
            <Link href={`/billing/invoices${qs(page.pageInfo.nextCursor)}`}>{t("invoices.nextPage")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
