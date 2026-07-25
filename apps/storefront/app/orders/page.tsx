import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listMyOrders } from "@hardware/core";
import { Badge, Button, Card, EmptyState, PageHeader, formatDateTime, formatMoney } from "@hardware/ui";
import { getCustomerSession } from "../../lib/session";
import { orderStatusLabel, orderStatusVariant } from "../../lib/order-status";
import { OrderFilters, type OrderFilterValues } from "./OrderFilters";

// Customer order history (04 §8) — OWNERSHIP-scoped to the session's customer. Adds
// SERVER-SIDE filtering (status + createdAt date range) via URL search params ->
// listMyOrders -> SQL. The reorder action lives on the detail page.

const ORDER_STATUSES = new Set([
  "PENDING_PAYMENT",
  "PAY_LATER",
  "CONFIRMED",
  "PACKED",
  "DISPATCHED",
  "COMPLETED",
  "CANCELLED",
]);

// A `yyyy-mm-dd` date string, or undefined if blank/invalid (additive — omit = no bound).
function parseDate(input: string | undefined): string | undefined {
  if (!input || !input.trim()) return undefined;
  return Number.isNaN(Date.parse(input)) ? undefined : input.trim();
}

interface OrdersSearchParams {
  status?: string;
  from?: string;
  to?: string;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>;
}) {
  const session = await getCustomerSession();
  if (!session || !session.customerId) redirect("/account");

  const t = await getTranslations("orders");

  const sp = await searchParams;
  const status = sp.status && ORDER_STATUSES.has(sp.status) ? sp.status : undefined;
  const from = parseDate(sp.from);
  const toDate = parseDate(sp.to);
  // `to` from a date input is midnight; widen to end-of-day so the upper bound is inclusive.
  const to = toDate ? `${toDate}T23:59:59.999` : undefined;

  const values: OrderFilterValues = {
    status: status ?? "",
    from: from ?? "",
    to: toDate ?? "",
  };
  const isFiltered = Boolean(status || from || toDate);

  const page = await listMyOrders(session.customerId, {
    status: status as never,
    from,
    to,
    limit: 50,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader size="2xl" title={t("title")} />

      <OrderFilters values={values} />

      {page.data.length === 0 ? (
        <EmptyState
          className="mt-8"
          title={isFiltered ? t("empty.filteredTitle") : t("empty.title")}
          description={
            isFiltered ? t("empty.filteredDescription") : t("empty.description")
          }
          action={
            isFiltered ? (
              <Button asChild variant="outline">
                <Link href="/orders">{t("empty.clearFilters")}</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/">{t("empty.browseCatalog")}</Link>
              </Button>
            )
          }
        />
      ) : (
        <Card className="mt-6 divide-y">
          {page.data.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0">
                <p className="font-medium">{o.orderNo}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(o.createdAt)} · {t("list.itemCount", { count: o.lines.length })}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant={orderStatusVariant(o.status)}>{orderStatusLabel(o.status)}</Badge>
                <p className="text-sm font-medium tabular-nums">{formatMoney(o.grandTotal)}</p>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
