import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listStock, listCategoryTree, requirePermission, Forbidden, type CategoryNode } from "@hardware/core";
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
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { StockNav, Forbid } from "./nav";
import { StockFilterBar } from "./StockFilterBar";
import { EditableStock } from "./EditableStock";

// Flatten the category tree into indented options for a native <select> (children
// prefixed with a non-breaking indent so the hierarchy is still readable).
function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
  out: { id: string; label: string }[] = [],
): { id: string; label: string }[] {
  for (const n of nodes) {
    out.push({ id: n.id, label: `${"  ".repeat(depth)}${n.name}` });
    if (n.children.length > 0) flattenCategories(n.children, depth + 1, out);
  }
  return out;
}

// Shared stock-status pill so the mobile cards and desktop table stay in sync.
function StockStatusBadge({
  outOfStock,
  lowStock,
  labels,
}: {
  outOfStock: boolean;
  lowStock: boolean;
  labels: { outOfStock: string; low: string; ok: string };
}) {
  if (outOfStock) return <Badge variant="destructive">{labels.outOfStock}</Badge>;
  if (lowStock) return <Badge variant="warning">{labels.low}</Badge>;
  return <Badge variant="success">{labels.ok}</Badge>;
}

// Stock list (S3): on-hand per product (base unit) with a low-stock flag, cursor-
// paginated. Read-only server component — guarded with stock.read. Filters (all
// server-side via the core listStock params): low-stock-only, category, and
// name/SKU search.
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lowOnly?: string; categoryId?: string; cursor?: string }>;
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
  const statusLabels = {
    outOfStock: t("list.statusOutOfStock"),
    low: t("list.statusLow"),
    ok: t("list.statusOk"),
  };

  const sp = await searchParams;
  const lowOnly = sp.lowOnly === "true";
  const categoryId = sp.categoryId || undefined;
  const [page, categoryTree] = await Promise.all([
    listStock({ q: sp.q, lowOnly, categoryId, cursor: sp.cursor, limit: 50 }),
    listCategoryTree(),
  ]);
  const categories = flattenCategories(categoryTree);

  const nextHref = page.pageInfo.nextCursor
    ? `/stock?${new URLSearchParams({
        ...(sp.q ? { q: sp.q } : {}),
        ...(lowOnly ? { lowOnly: "true" } : {}),
        ...(categoryId ? { categoryId } : {}),
        cursor: page.pageInfo.nextCursor,
      })}`
    : null;

  const rows = page.data;

  return (
    <div className="space-y-6">
      <StockNav active="list" />

      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <Button asChild>
            <Link href="/stock/grn">{t("list.newGrn")}</Link>
          </Button>
        }
      />

      <StockFilterBar
        q={sp.q ?? ""}
        categoryId={categoryId ?? ""}
        lowOnly={lowOnly}
        categories={categories}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={t("list.emptyTitle")}
          description={
            lowOnly || sp.q || categoryId
              ? t("list.emptyFiltered")
              : t("list.emptyDefault")
          }
          action={
            <Button asChild>
              <Link href="/stock/grn">{t("list.newGrn")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Mobile: stacked cards (the 8-column table can't fit at ~360px). */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => {
              const outOfStock = Number(r.available) <= 0;
              return (
                <li key={r.productId} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/stock/movements?productId=${r.productId}`}
                        className="block font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {r.sku} · {r.baseUnitCode}
                      </p>
                    </div>
                    <StockStatusBadge outOfStock={outOfStock} lowStock={r.lowStock} labels={statusLabels} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground">{t("list.cardOnHand")}</dt>
                      <dd>
                        <EditableStock
                          productId={r.productId}
                          onHand={r.onHand}
                          baseUnitCode={r.baseUnitCode}
                        />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t("list.cardReserved")}</dt>
                      <dd className="tabular-nums">{formatQty(r.reserved)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t("list.cardAvailable")}</dt>
                      <dd className="tabular-nums">{formatQty(r.available)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t("list.cardReorder")}</dt>
                      <dd className="tabular-nums">
                        {r.reorderLevel != null ? formatQty(r.reorderLevel) : "—"}
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
                  <TableHead>{t("list.colProduct")}</TableHead>
                  <TableHead>{t("list.colSku")}</TableHead>
                  <TableHead>{t("list.colBase")}</TableHead>
                  <TableHead numeric>{t("list.colOnHand")}</TableHead>
                  <TableHead numeric>{t("list.colReserved")}</TableHead>
                  <TableHead numeric>{t("list.colAvailable")}</TableHead>
                  <TableHead numeric>{t("list.colReorder")}</TableHead>
                  <TableHead>{t("list.colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const outOfStock = Number(r.available) <= 0;
                  return (
                    <TableRow key={r.productId}>
                      <TableCell>
                        <Link
                          href={`/stock/movements?productId=${r.productId}`}
                          className="font-medium hover:underline"
                        >
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.sku}</TableCell>
                      <TableCell>{r.baseUnitCode}</TableCell>
                      <TableCell numeric>
                        <EditableStock
                          productId={r.productId}
                          onHand={r.onHand}
                          baseUnitCode={r.baseUnitCode}
                        />
                      </TableCell>
                      <TableCell numeric>{formatQty(r.reserved)}</TableCell>
                      <TableCell numeric>{formatQty(r.available)}</TableCell>
                      <TableCell numeric>
                        {r.reorderLevel != null ? formatQty(r.reorderLevel) : "—"}
                      </TableCell>
                      <TableCell>
                        <StockStatusBadge outOfStock={outOfStock} lowStock={r.lowStock} labels={statusLabels} />
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
            <Link href={nextHref}>{t("list.nextPage")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
