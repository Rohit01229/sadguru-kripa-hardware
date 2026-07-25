import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listMovements,
  listProducts,
  getProduct,
  requirePermission,
  Forbidden,
  type MovementKindFilter,
} from "@hardware/core";
import {
  PageHeader,
  Button,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  formatQty,
  formatDateTime,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { StockNav, Forbid } from "../nav";
import { MovementsFilterBar } from "./MovementsFilterBar";

// The movement kinds the ledger can be filtered to (mirrors the core
// movementKindSchema enum). Each carries the translation key for its filter label;
// the raw enum stays visible in the table badge so the filter is self-explanatory.
const MOVEMENT_KINDS: { value: MovementKindFilter; labelKey: string }[] = [
  { value: "GRN_IN", labelKey: "grnIn" },
  { value: "SALE_OUT", labelKey: "saleOut" },
  { value: "KACHA_OUT", labelKey: "kachaOut" },
  { value: "ADJUST_IN", labelKey: "adjustIn" },
  { value: "ADJUST_OUT", labelKey: "adjustOut" },
  { value: "SALES_RETURN_IN", labelKey: "salesReturnIn" },
  { value: "PURCHASE_RETURN_OUT", labelKey: "purchaseReturnOut" },
  { value: "ORDER_DISPATCH_OUT", labelKey: "orderDispatchOut" },
];

function isMovementKind(v: string | undefined): v is MovementKindFilter {
  return !!v && MOVEMENT_KINDS.some((k) => k.value === v);
}

// Movement ledger (S3): every StockMovement kind, including KACHA_OUT shown as an
// unattributed stock-out (03 §6). Filter by product / kind / date range, all
// server-side via the core listMovements params; cursor-paginated. Read-only —
// guarded with stock.read.
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    productId?: string;
    kind?: string;
    from?: string;
    to?: string;
    cursor?: string;
  }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="stock.read" />;
    throw e;
  }

  const t = await getTranslations("stock");
  const kinds = MOVEMENT_KINDS.map((k) => ({ value: k.value, label: t(`movements.kinds.${k.labelKey}`) }));

  const sp = await searchParams;
  const kind = isMovementKind(sp.kind) ? sp.kind : undefined;
  const [page, product, productPage] = await Promise.all([
    listMovements({
      productId: sp.productId || undefined,
      kind,
      from: sp.from || undefined,
      to: sp.to || undefined,
      cursor: sp.cursor || undefined,
      limit: 50,
    }),
    sp.productId ? getProduct(sp.productId) : Promise.resolve(null),
    listProducts({ limit: 200 }),
  ]);
  const products = productPage.data;

  const baseQuery = {
    ...(sp.productId ? { productId: sp.productId } : {}),
    ...(kind ? { kind } : {}),
    ...(sp.from ? { from: sp.from } : {}),
    ...(sp.to ? { to: sp.to } : {}),
  };
  const nextHref = page.pageInfo.nextCursor
    ? `/stock/movements?${new URLSearchParams({ ...baseQuery, cursor: page.pageInfo.nextCursor })}`
    : null;

  const hasFilters = Boolean(sp.productId || kind || sp.from || sp.to);
  const rows = page.data;

  return (
    <div className="space-y-6">
      <StockNav active="movements" />

      <PageHeader
        title={t("movements.title")}
        description={
          product ? (
            <>
              {t("movements.filteredTo")} <span className="font-medium text-foreground">{product.name}</span> ({product.sku}) ·{" "}
              <Link href="/stock/movements" className="underline hover:text-foreground">
                {t("movements.clearFilter")}
              </Link>
            </>
          ) : (
            t("movements.description")
          )
        }
      />

      <MovementsFilterBar
        productId={sp.productId ?? ""}
        kind={kind ?? ""}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
        products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))}
        kinds={kinds}
        hasFilters={hasFilters}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={t("movements.emptyTitle")}
          description={
            hasFilters
              ? t("movements.emptyFiltered")
              : t("movements.emptyDefault")
          }
        />
      ) : (
        <>
          {/* Mobile: stacked cards. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((m) => {
              const positive = !m.baseQty.startsWith("-");
              return (
                <li key={m.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Badge variant="outline" className="font-mono">
                      {m.kind}
                    </Badge>
                    <span
                      className={`font-medium tabular-nums ${positive ? "text-success" : "text-destructive"}`}
                    >
                      {positive ? "+" : ""}
                      {formatQty(m.baseQty)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("movements.cardRef")}</dt>
                      <dd className="text-right">
                        {m.refType ? `${m.refType}${m.refId ? ` ${m.refId.slice(0, 8)}` : ""}` : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("movements.cardReason")}</dt>
                      <dd className="text-right">{m.reason ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("movements.cardActor")}</dt>
                      <dd className="text-right">
                        {m.kind === "KACHA_OUT" ? (
                          <em>{t("movements.unattributed")}</em>
                        ) : (
                          (m.actorStaffId?.slice(0, 8) ?? "—")
                        )}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>

          {/* Desktop/tablet: full table. */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("movements.colWhen")}</TableHead>
                  <TableHead>{t("movements.colKind")}</TableHead>
                  <TableHead numeric>{t("movements.colQtyBase")}</TableHead>
                  <TableHead>{t("movements.colRef")}</TableHead>
                  <TableHead>{t("movements.colReason")}</TableHead>
                  <TableHead>{t("movements.colActor")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const positive = !m.baseQty.startsWith("-");
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {m.kind}
                        </Badge>
                      </TableCell>
                      <TableCell
                        numeric
                        className={`font-medium ${positive ? "text-success" : "text-destructive"}`}
                      >
                        {positive ? "+" : ""}
                        {formatQty(m.baseQty)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.refType ? `${m.refType}${m.refId ? ` ${m.refId.slice(0, 8)}` : ""}` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.reason ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.kind === "KACHA_OUT" ? (
                          <em>{t("movements.unattributed")}</em>
                        ) : (
                          (m.actorStaffId?.slice(0, 8) ?? "—")
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {nextHref && (
        <div>
          <Button asChild variant="outline">
            <Link href={nextHref}>{t("movements.nextPage")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
