import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listProducts,
  listBrands,
  listCategoryTree,
  requirePermission,
  Forbidden,
  cldThumb,
  type CategoryNode,
  type ProductSort,
} from "@hardware/core";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ForbiddenState,
  formatMoney,
  formatQty,
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { CatalogFilterBar } from "./CatalogFilterBar";

// Product list (S2): server-side search + filter (category / brand / in-stock /
// status / sort) via the core `listProducts` params, all driven by URL search
// params; cursor pagination. Read-only server component — guarded products.read.
// Responsive: filter bar stacks to one column and the results render as stacked
// cards on small screens (md:hidden) and a scrollable table from md up.

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "price_asc", label: "Price (low → high)" },
  { value: "price_desc", label: "Price (high → low)" },
  { value: "newest", label: "Newest" },
];
const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((o) => o.value));

// Status maps 1:1 to the core query's only archive lever (`includeArchived`),
// so filtering stays fully server-side: "active" = live only, "all" = include
// archived. (An "archived-only" option would need a client filter over a partial
// page — excluded by design; the Active badge in the row makes archived obvious.)
type StatusFilter = "active" | "all";

interface CatalogSearchParams {
  q?: string;
  categoryId?: string;
  brandId?: string;
  inStock?: string;
  status?: string;
  sort?: string;
  cursor?: string;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogSearchParams>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "products.read");
  } catch (e) {
    if (e instanceof Forbidden) {
      return (
        <div className="space-y-6">
          <ForbiddenState perm="products.read" />
        </div>
      );
    }
    throw e;
  }

  const t = await getTranslations("catalog");
  const tc = await getTranslations("common");
  const sp = await searchParams;

  // ── Normalise URL params into the core query (server-side filtering only) ──
  const status: StatusFilter = sp.status === "all" ? "all" : "active";
  const sort: ProductSort = (sp.sort && SORT_VALUES.has(sp.sort) ? sp.sort : "relevance") as ProductSort;
  const inStockOnly = sp.inStock === "true";

  // Only the fast filter-option reads stay at the page level (they populate the filter
  // bar selects). The slow product list streams separately via <Suspense> below.
  const [brands, tree] = await Promise.all([listBrands(), listCategoryTree()]);
  const categories = flatten(tree);

  const isFiltered = Boolean(
    sp.q || sp.categoryId || sp.brandId || inStockOnly || status !== "active" || sort !== "relevance",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={tc("nav.catalog")}
        description={t("list.description")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/catalog/masters">{t("list.mastersLink")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/catalog/import">{t("list.importLink")}</Link>
            </Button>
            <Button asChild>
              <Link href="/catalog/new">{t("list.newProduct")}</Link>
            </Button>
          </>
        }
      />

      {/* Filter bar — GET form so every filter lands in the URL (shareable, server-side).
          Extracted to a client component that intercepts submit for no-reload navigation;
          action="/catalog" stays as the no-JS fallback. */}
      <CatalogFilterBar
        values={{
          q: sp.q ?? "",
          categoryId: sp.categoryId ?? "",
          brandId: sp.brandId ?? "",
          status,
          sort,
          inStockOnly,
        }}
        categories={categories}
        brands={brands}
        isFiltered={isFiltered}
      />

      {/* The product list is the slow read; stream it so the filter bar above stays
          interactive. The Suspense key is the filter/sort/cursor signature so changing
          a filter re-suspends to the skeleton. */}
      <Suspense
        key={`${sp.q ?? ""}|${sp.categoryId ?? ""}|${sp.brandId ?? ""}|${inStockOnly}|${status}|${sort}|${sp.cursor ?? ""}`}
        fallback={<CatalogResultsSkeleton />}
      >
        <CatalogResults sp={sp} status={status} sort={sort} inStockOnly={inStockOnly} isFiltered={isFiltered} />
      </Suspense>
    </div>
  );
}

/** The slow region: load + render the product list (cards on mobile, table on md+). */
async function CatalogResults({
  sp,
  status,
  sort,
  inStockOnly,
  isFiltered,
}: {
  sp: CatalogSearchParams;
  status: StatusFilter;
  sort: ProductSort;
  inStockOnly: boolean;
  isFiltered: boolean;
}) {
  const t = await getTranslations("catalog");
  const page = await listProducts({
    q: sp.q,
    categoryId: sp.categoryId,
    brandId: sp.brandId,
    inStockOnly,
    sort,
    includeArchived: status === "all",
    cursor: sp.cursor,
    limit: 50,
  });
  const rows = page.data;

  // Sort other than `relevance` disables cursor pagination in core (first page
  // only), so only offer "Next page" when the cursor is actually pageable.
  const nextHref = page.pageInfo.nextCursor
    ? `/catalog?${new URLSearchParams({ ...cleaned(sp), cursor: page.pageInfo.nextCursor }).toString()}`
    : null;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={isFiltered ? t("list.emptyFilteredTitle") : t("list.emptyTitle")}
        description={
          isFiltered
            ? t("list.emptyFilteredDescription")
            : t("list.emptyDescription")
        }
        action={
          <>
            {isFiltered ? (
              <Button variant="outline" asChild>
                <Link href="/catalog">{t("list.clearFilters")}</Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link href="/catalog/import">{t("list.importLink")}</Link>
            </Button>
            <Button asChild>
              <Link href="/catalog/new">{t("list.newProduct")}</Link>
            </Button>
          </>
        }
      />
    );
  }

  return (
    <>
      {/* Mobile (< md): stacked cards. One card per product, no horizontal overflow. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((p) => {
          const def = p.saleUnits.find((s) => s.isDefault) ?? p.saleUnits[0];
          return (
            <li key={p.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Thumb url={p.imageKeys[0]} size={48} />
                  <Link
                    href={`/catalog/${p.id}`}
                    className="min-w-0 flex-1 font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                </div>
                {p.isActive ? (
                  <Badge variant="success">{t("list.statusActive")}</Badge>
                ) : (
                  <Badge variant="default">{t("list.statusArchived")}</Badge>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <Field label={t("list.colSku")} value={p.sku} mono />
                <Field label={t("list.fieldBrand")} value={p.brand ?? "—"} />
                <Field label={t("list.fieldBaseUnit")} value={p.baseUnit.code} />
                <Field label={t("list.colSaleUnits")} value={String(p.saleUnits.length)} />
                <Field
                  label={t("list.colDefaultPrice")}
                  value={def ? `${formatMoney(def.salePrice)} / ${def.unitCode}` : "—"}
                />
                <Field label={t("list.colAvailable")} value={formatQty(p.availableBase)} />
              </dl>
            </li>
          );
        })}
      </ul>

      {/* md+: scrollable table (horizontal scroll only on very wide content). */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("list.colName")}</TableHead>
              <TableHead>{t("list.colSku")}</TableHead>
              <TableHead>{t("list.colBrand")}</TableHead>
              <TableHead>{t("list.colBase")}</TableHead>
              <TableHead numeric>{t("list.colSaleUnits")}</TableHead>
              <TableHead numeric>{t("list.colDefaultPrice")}</TableHead>
              <TableHead numeric>{t("list.colAvailable")}</TableHead>
              <TableHead>{t("list.colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const def = p.saleUnits.find((s) => s.isDefault) ?? p.saleUnits[0];
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Thumb url={p.imageKeys[0]} size={40} />
                      <Link href={`/catalog/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.sku}</TableCell>
                  <TableCell>{p.brand ?? "—"}</TableCell>
                  <TableCell>{p.baseUnit.code}</TableCell>
                  <TableCell numeric>{p.saleUnits.length}</TableCell>
                  <TableCell numeric>
                    {def ? `${formatMoney(def.salePrice)} / ${def.unitCode}` : "—"}
                  </TableCell>
                  <TableCell numeric>{formatQty(p.availableBase)}</TableCell>
                  <TableCell>
                    {p.isActive ? (
                      <Badge variant="success">{t("list.statusActive")}</Badge>
                    ) : (
                      <Badge variant="default">{t("list.statusArchived")}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {nextHref && (
        <div className="mt-6 flex justify-end">
          <Button variant="outline" asChild className="min-h-[2.75rem] w-full sm:w-auto">
            <Link href={nextHref}>{t("list.nextPage")}</Link>
          </Button>
        </div>
      )}
    </>
  );
}

/** Table-shaped placeholder shown while the product list streams in. */
function CatalogResultsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="space-y-3 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Square product thumbnail (Cloudinary-derived) or a neutral placeholder. */
function Thumb({ url, size = 40 }: { url?: string; size?: number }) {
  const cls = "shrink-0 overflow-hidden rounded border bg-muted";
  if (!url) {
    return (
      <div
        className={`${cls} flex items-center justify-center text-muted-foreground`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cldThumb(url)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`${cls} object-cover`}
      style={{ width: size, height: size }}
    />
  );
}

/** A label/value pair for the mobile product card. */
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono" : "truncate"}>{value}</dd>
    </div>
  );
}

/** Flatten the category tree into indented options for the filter select. */
function flatten(tree: CategoryNode[], depth = 0): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const node of tree) {
    out.push({ id: node.id, name: `${"— ".repeat(depth)}${node.name}` });
    if (node.children.length) out.push(...flatten(node.children, depth + 1));
  }
  return out;
}

/** Keep current filters in pagination links; drop the cursor (re-added by caller). */
function cleaned(sp: CatalogSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (v && k !== "cursor") out[k] = v;
  return out;
}
