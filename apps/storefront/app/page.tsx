import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  listProducts,
  listBrands,
  listCategoryTree,
  cldThumb,
  type CategoryNode,
  type ProductSort,
} from "@hardware/core";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  formatMoney,
} from "@hardware/ui";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogSearch } from "./CatalogSearch";
import {
  countActiveFilters,
  type BrandOption,
  type CatalogFilterValues,
  type CategoryOption,
} from "./catalog-filters-shared";

// Public catalog (S2 + S3 live stock). Reads the storefront-safe projection via
// @hardware/core (no cost/supplier fields). SERVER-SIDE filtering only: every filter /
// sort is a URL search param -> listProducts query -> SQL. Desktop shows a filter
// sidebar; mobile collapses the filters into a Sheet drawer (CatalogFilters). The
// in-stock badge reflects LIVE aggregate available (onHand − reserved) from ProductStock.

const PAGE_SIZE = 24;

interface CatalogSearchParams {
  q?: string;
  cursor?: string;
  prev?: string; // back-cursor breadcrumb (comma-separated history of page-start cursors)
  categoryId?: string;
  brandId?: string;
  priceMin?: string;
  priceMax?: string;
  inStockOnly?: string;
  sort?: string;
}

const SORT_VALUES: readonly ProductSort[] = [
  "relevance",
  "price_asc",
  "price_desc",
  "name_asc",
  "newest",
];

/** Coerce a free-form `sort` URL param to a known ProductSort, defaulting to relevance. */
function parseSort(input: string | undefined): ProductSort {
  return SORT_VALUES.includes(input as ProductSort) ? (input as ProductSort) : "relevance";
}

/** Rupees-as-typed → integer paise, or undefined when blank/invalid. */
function rupeesToPaise(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const n = Number(input.trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

/** Flatten the category tree into indented <option> labels (two spaces per depth level). */
function flattenCategories(nodes: CategoryNode[], depth = 0): CategoryOption[] {
  const out: CategoryOption[] = [];
  for (const n of nodes) {
    out.push({ value: n.id, label: `${"  ".repeat(depth)}${n.name}` });
    if (n.children.length > 0) out.push(...flattenCategories(n.children, depth + 1));
  }
  return out;
}

/** Build a "/" href carrying the current filter set plus the supplied overrides. */
function buildHref(values: CatalogFilterValues, overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  const set = (k: string, v: string | undefined) => {
    if (v && v.trim().length > 0) params.set(k, v);
  };
  set("q", values.q);
  set("categoryId", values.categoryId);
  set("brandId", values.brandId);
  set("priceMin", values.priceMin);
  set("priceMax", values.priceMax);
  if (values.inStockOnly) params.set("inStockOnly", "1");
  if (values.sort && values.sort !== "relevance") params.set("sort", values.sort);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogSearchParams>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("catalog");

  const values: CatalogFilterValues = {
    q: sp.q ?? "",
    categoryId: sp.categoryId ?? "",
    brandId: sp.brandId ?? "",
    priceMin: sp.priceMin ?? "",
    priceMax: sp.priceMax ?? "",
    inStockOnly: sp.inStockOnly === "1" || sp.inStockOnly === "true",
    sort: parseSort(sp.sort),
  };
  const sort = values.sort as ProductSort;

  // Fast filter-option reads stay at the page level so the header + search form +
  // filter sidebar render with the shell. The slow product grid (listProducts) is
  // streamed separately via <Suspense> below, so the page no longer blocks the whole
  // content region on the slowest query.
  const [tree, brands] = await Promise.all([listCategoryTree(), listBrands()]);

  const categories: CategoryOption[] = flattenCategories(tree);
  const brandOptions: BrandOption[] = brands.map((b) => ({ value: b.id, label: b.name }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        size="2xl"
        title={t("heading")}
        description={t("description")}
      />

      <CatalogSearch values={values} />

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[16rem_1fr]">
        {/* Filters: a Sheet drawer on mobile, an always-visible sidebar on desktop. */}
        <CatalogFilters values={values} categories={categories} brands={brandOptions} />

        {/* The product grid is the slow read (live stock). Stream it on its own so the
            header + search + filters above paint immediately. The Suspense key is the
            full filter/sort/cursor signature so navigating filters re-suspends. */}
        <Suspense
          key={`${values.q}|${values.categoryId}|${values.brandId}|${values.priceMin}|${values.priceMax}|${values.inStockOnly}|${sort}|${sp.cursor ?? ""}`}
          fallback={<ProductGridSkeleton />}
        >
          <ProductGrid values={values} sort={sort} cursor={sp.cursor} prev={sp.prev} />
        </Suspense>
      </div>
    </div>
  );
}

/** The slow region: load + render the product page and its prev/next pagination. */
async function ProductGrid({
  values,
  sort,
  cursor,
  prev,
}: {
  values: CatalogFilterValues;
  sort: ProductSort;
  cursor: string | undefined;
  prev: string | undefined;
}) {
  const t = await getTranslations("catalog");
  const page = await listProducts({
    q: values.q || undefined,
    categoryId: values.categoryId || undefined,
    brandId: values.brandId || undefined,
    priceMinPaise: rupeesToPaise(values.priceMin),
    priceMaxPaise: rupeesToPaise(values.priceMax),
    inStockOnly: values.inStockOnly || undefined,
    sort,
    cursor,
    limit: PAGE_SIZE,
  });

  // Cursor pagination is only stable for the default `relevance` sort (core disables it
  // otherwise). Prev/Next walk a comma-separated breadcrumb of page-start cursors in `prev`.
  const cursorablePagination = sort === "relevance";
  const prevTrail = (prev ?? "").split(",").filter(Boolean);

  // Next: push the CURRENT page-start cursor onto the breadcrumb (sentinel "0" for page 1,
  // which has no cursor) so Previous can walk back to it.
  const nextHref =
    cursorablePagination && page.pageInfo.nextCursor
      ? buildHref(values, {
          cursor: page.pageInfo.nextCursor,
          prev: [...prevTrail, cursor ?? "0"].join(","),
        })
      : null;

  // Previous = pop the last breadcrumb back to the prior page-start cursor ("0" → page 1).
  const prevHref =
    cursorablePagination && prevTrail.length > 0
      ? buildHref(values, {
          cursor: prevTrail[prevTrail.length - 1] === "0" ? undefined : prevTrail[prevTrail.length - 1],
          prev: prevTrail.slice(0, -1).join(",") || undefined,
        })
      : null;

  const hasQuery = Boolean(values.q && values.q.trim().length > 0);
  const isFiltered = hasQuery || countActiveFilters(values) > 0;

  return (
    <div>
      {page.data.length === 0 ? (
        <EmptyState
          title={isFiltered ? t("empty.filteredTitle") : t("empty.title")}
          description={
            isFiltered
              ? t("empty.filteredDescription")
              : t("empty.description")
          }
          action={
            isFiltered ? (
              <Button asChild variant="outline">
                <Link href="/">{t("empty.clearAllFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {page.data.map((p) => {
            const def = p.saleUnits.find((s) => s.isDefault) ?? p.saleUnits[0];
            const inStock = Number(p.availableBase) > 0;
            return (
              <li key={p.id}>
                <Card className="group flex h-full flex-col overflow-hidden p-0 transition-shadow hover:shadow-md">
                  <Link
                    href={`/products/${p.id}`}
                    className="block aspect-square w-full overflow-hidden bg-muted"
                    aria-label={p.name}
                  >
                    {p.imageKeys[0] ? (
                      <img
                        src={cldThumb(p.imageKeys[0])}
                        alt={p.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="m21 15-5-5L5 21" />
                        </svg>
                      </span>
                    )}
                  </Link>
                  <div className="flex flex-1 flex-col p-4">
                  <Link
                    href={`/products/${p.id}`}
                    className="font-medium leading-snug group-hover:text-primary group-hover:underline"
                  >
                    {p.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.brand ?? p.sku}</p>
                  <div className="mt-auto pt-3">
                    {def && (
                      <p className="text-sm font-semibold tabular-nums">
                        {formatMoney(def.salePrice)}
                        <span className="font-normal text-muted-foreground"> / {def.unitCode}</span>
                      </p>
                    )}
                    <Badge variant={inStock ? "success" : "destructive"} className="mt-2">
                      {inStock ? t("stock.inStock") : t("stock.outOfStock")}
                    </Badge>
                  </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {(prevHref || nextHref) && (
        <nav className="mt-8 flex items-center justify-between gap-3" aria-label={t("pagination.label")}>
          {prevHref ? (
            <Button asChild variant="outline">
              <Link href={prevHref}>{t("pagination.previous")}</Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              {t("pagination.previous")}
            </Button>
          )}
          {nextHref ? (
            <Button asChild variant="outline">
              <Link href={nextHref}>{t("pagination.next")}</Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              {t("pagination.next")}
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}

/** Grid-shaped placeholder shown while the product page streams in. */
function ProductGridSkeleton() {
  return (
    <div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i}>
            <Card className="flex h-full flex-col overflow-hidden p-0">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="flex flex-1 flex-col p-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/3" />
                <div className="mt-auto pt-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="mt-2 h-5 w-20 rounded-full" />
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
