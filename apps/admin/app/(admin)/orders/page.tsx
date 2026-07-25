import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listOrdersAdmin, requirePermission, Forbidden, type OrderDTO } from "@hardware/core";
import {
  PageHeader,
  TabsList,
  TabsLink,
  DataTable,
  Badge,
  Skeleton,
  ForbiddenState,
  formatMoney,
  formatDateTime,
  type DataTableColumn,
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { FulfilButtons } from "./FulfilButtons";
import { OrdersDateFilter } from "./OrdersDateFilter";
import { statusVariant, paymentVariant } from "./status";

// Admin order queue (04 §8; 🔒S [orders.read]). Lists orders (filterable by status +
// createdAt date range) with the single next fulfilment action per row: accept → pack
// → dispatch → complete. Dispatch converts the reservation to a final decrement AND
// generates the pakka invoice (pakka-on-dispatch).
//
// Filtering is SERVER-SIDE (URL search params → listOrdersAdmin → SQL): `status` from
// the tabs, `from`/`to` (inclusive createdAt bounds) from the date form. The status
// tab links carry the active date range, and the date form carries the active status,
// so the two filters compose without one clearing the other.
const STATUSES = ["PENDING_PAYMENT", "PAY_LATER", "CONFIRMED", "PACKED", "DISPATCHED", "COMPLETED", "CANCELLED"] as const;

/** Build a /orders href preserving the given params (drops empties). */
function ordersHref(params: { status?: string; from?: string; to?: string }): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const s = qs.toString();
  return s ? `/orders?${s}` : "/orders";
}

/** Validate a yyyy-mm-dd date input; return undefined when blank/unparseable. */
function parseDateInput(v: string | undefined): string | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  return Number.isNaN(Date.parse(t)) ? undefined : t;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "orders.read");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="orders.read" />;
    throw e;
  }

  const t = await getTranslations("orders");

  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as (typeof STATUSES)[number])
    : undefined;
  const from = parseDateInput(sp.from);
  const to = parseDateInput(sp.to);
  // `to` is an inclusive day bound — push it to end-of-day so the whole day is covered
  // (the input is a date, the column is a timestamp).
  const toBound = to ? `${to}T23:59:59.999` : undefined;
  const isFiltered = Boolean(status) || Boolean(from) || Boolean(to);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {/* Status filter tabs. The list scrolls horizontally on narrow screens instead
          of wrapping into many rows; each link preserves the active date range. */}
      <TabsList
        aria-label={t("tabs.filterAria")}
        className="flex-nowrap overflow-x-auto"
      >
        <TabsLink active={!status}>
          <Link href={ordersHref({ from, to })} className="whitespace-nowrap">
            {t("tabs.all")}
          </Link>
        </TabsLink>
        {STATUSES.map((s) => (
          <TabsLink key={s} active={status === s}>
            <Link href={ordersHref({ status: s, from, to })} className="whitespace-nowrap">
              {t(`status.${s}`)}
            </Link>
          </TabsLink>
        ))}
      </TabsList>

      {/* Server-side date-range filter (createdAt). Extracted to a client component that
          intercepts submit for no-reload navigation; action="/orders" stays as the no-JS
          fallback and the active status is preserved across the date filter. */}
      <OrdersDateFilter status={status ?? ""} from={from ?? ""} to={to ?? ""} isFiltered={isFiltered} />

      {/* The order list is the slow read; stream it under Suspense so the status tabs +
          date filter above paint immediately. Re-suspends on filter change via the key. */}
      <Suspense key={`${status ?? ""}|${from ?? ""}|${to ?? ""}`} fallback={<OrdersTableSkeleton />}>
        <OrdersTable status={status} from={from} toBound={toBound} isFiltered={isFiltered} />
      </Suspense>
    </div>
  );
}

/** The slow region: load + render the filtered order queue. */
async function OrdersTable({
  status,
  from,
  toBound,
  isFiltered,
}: {
  status: (typeof STATUSES)[number] | undefined;
  from: string | undefined;
  toBound: string | undefined;
  isFiltered: boolean;
}) {
  const t = await getTranslations("orders");
  const page = await listOrdersAdmin({
    status,
    ...(from ? { from } : {}),
    ...(toBound ? { to: toBound } : {}),
    limit: 100,
  });

  const columns: DataTableColumn<OrderDTO>[] = [
    {
      key: "order",
      header: t("table.colOrder"),
      cell: (o) => (
        <div className="min-w-0">
          <div className="font-medium">{o.orderNo}</div>
          <div className="text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: t("table.colStatus"),
      cell: (o) => <Badge variant={statusVariant(o.status)}>{t(`status.${o.status}`)}</Badge>,
    },
    {
      key: "fulfilment",
      header: t("table.colFulfilment"),
      cell: (o) => (
        <Badge variant="outline">
          {o.fulfilment === "DELIVERY" ? t("fulfilment.delivery") : t("fulfilment.pickup")}
        </Badge>
      ),
    },
    {
      key: "payment",
      header: t("table.colPayment"),
      cell: (o) => <Badge variant={paymentVariant(o.paymentStatus)}>{t(`payment.${o.paymentStatus}`)}</Badge>,
    },
    {
      key: "total",
      header: t("table.colTotal"),
      numeric: true,
      cell: (o) => formatMoney(o.grandTotal),
    },
    {
      key: "invoice",
      header: t("table.colInvoice"),
      cell: (o) =>
        o.invoice ? (
          <span className="font-mono text-xs">{o.invoice.invoiceNo}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "action",
      header: t("table.colAction"),
      cell: (o) => <FulfilButtons id={o.id} status={o.status} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={page.data}
      getRowKey={(o) => o.id}
      empty={{
        title: t("empty.title"),
        description: isFiltered ? t("empty.filtered") : t("empty.default"),
      }}
    />
  );
}

/** Table-shaped placeholder shown while the order queue streams in. */
function OrdersTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="space-y-3 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
