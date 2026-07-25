"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  FormField,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@hardware/ui";
import {
  countActiveFilters,
  type BrandOption,
  type CatalogFilterValues,
  type CategoryOption,
} from "./catalog-filters-shared";

// Re-export the shared filter types so existing importers of "./CatalogFilters" keep working.
export type { BrandOption, CatalogFilterValues, CategoryOption } from "./catalog-filters-shared";

// Storefront catalog filters (server-side: every control writes a URL search param
// that the page reads and forwards to @hardware/core listProducts -> SQL). The SAME
// field set renders twice: an always-visible desktop sidebar (md+) and a mobile Sheet
// drawer (under md) opened by a "Filters" button that carries an active-filter count
// Badge. Submitting (Apply) navigates with the new params via a GET form to "/".

// `labelKey` is a catalog.sort.* message key resolved at render time (so the labels
// localize); `value` is the URL/sort param sent to listProducts and must stay stable.
const SORT_OPTIONS: { labelKey: string; value: string }[] = [
  { labelKey: "sort.relevance", value: "relevance" },
  { labelKey: "sort.priceAsc", value: "price_asc" },
  { labelKey: "sort.priceDesc", value: "price_desc" },
  { labelKey: "sort.nameAsc", value: "name_asc" },
  { labelKey: "sort.newest", value: "newest" },
];

/** Build the "/" href that clears every filter but preserves the active search term. */
function clearedHref(q: string): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/**
 * The filter fields themselves (no chrome). `idPrefix` keeps input ids unique between the
 * desktop and mobile copies so labels stay correctly associated. Submitting the enclosing
 * GET form serialises these into the URL.
 */
function FilterFields({
  values,
  categories,
  brands,
  idPrefix,
}: {
  values: CatalogFilterValues;
  categories: CategoryOption[];
  brands: BrandOption[];
  idPrefix: string;
}) {
  const t = useTranslations("catalog");
  return (
    <div className="space-y-4">
      {/* Preserve the current search term across a filter submit. */}
      <input type="hidden" name="q" value={values.q} />

      <FormField label={t("filters.category")} htmlFor={`${idPrefix}-category`}>
        <Select
          id={`${idPrefix}-category`}
          name="categoryId"
          defaultValue={values.categoryId}
          className="h-11 md:h-9"
        >
          <option value="">{t("filters.allCategories")}</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("filters.brand")} htmlFor={`${idPrefix}-brand`}>
        <Select
          id={`${idPrefix}-brand`}
          name="brandId"
          defaultValue={values.brandId}
          className="h-11 md:h-9"
        >
          <option value="">{t("filters.allBrands")}</option>
          {brands.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("filters.price")} hint={t("filters.priceHint")}>
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-price-min`}
            name="priceMin"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            defaultValue={values.priceMin}
            placeholder={t("filters.priceMin")}
            aria-label={t("filters.priceMinLabel")}
            className="h-11 tabular-nums md:h-9"
          />
          <span className="text-muted-foreground" aria-hidden="true">
            –
          </span>
          <Input
            id={`${idPrefix}-price-max`}
            name="priceMax"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            defaultValue={values.priceMax}
            placeholder={t("filters.priceMax")}
            aria-label={t("filters.priceMaxLabel")}
            className="h-11 tabular-nums md:h-9"
          />
        </div>
      </FormField>

      <label
        htmlFor={`${idPrefix}-instock`}
        className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm"
      >
        <Checkbox
          id={`${idPrefix}-instock`}
          name="inStockOnly"
          value="1"
          defaultChecked={values.inStockOnly}
        />
        <span>{t("filters.inStockOnly")}</span>
      </label>

      <FormField label={t("filters.sortBy")} htmlFor={`${idPrefix}-sort`}>
        <Select
          id={`${idPrefix}-sort`}
          name="sort"
          defaultValue={values.sort || "relevance"}
          className="h-11 md:h-9"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}

export function CatalogFilters({
  values,
  categories,
  brands,
}: {
  values: CatalogFilterValues;
  categories: CategoryOption[];
  brands: BrandOption[];
}) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const activeCount = countActiveFilters(values);

  // Intercept the GET form submit so applying filters is a client-side soft navigation
  // (RSC fetch) instead of a full-document reload. Drop empty values so the URL stays
  // clean (matching how the server page only emits hidden inputs for set values). The
  // checkbox emits no entry when unchecked and `inStockOnly=1` when checked, and `q` is
  // carried via a hidden input inside FilterFields, so FormData handles both for free.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const s = String(v).trim();
      if (s) params.set(k, s);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/?${qs}` : "/"));
  }

  return (
    <>
      {/* ── Mobile: a "Filters" button (with active count) that opens the Sheet drawer ── */}
      <div className="md:hidden">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-center gap-2"
          aria-haspopup="dialog"
          onClick={() => setMobileOpen(true)}
        >
          <FilterIcon />
          {t("filters.heading")}
          {activeCount > 0 ? (
            <Badge variant="primary" className="ml-1 h-5 min-w-[1.25rem] justify-center px-1 tabular-nums">
              {activeCount}
            </Badge>
          ) : null}
        </Button>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-80 max-w-[85vw]">
            <SheetHeader>
              <SheetTitle>{t("filters.heading")}</SheetTitle>
            </SheetHeader>
            <form
              action="/"
              role="search"
              className="flex flex-1 flex-col"
              onSubmit={(e) => {
                setMobileOpen(false);
                submit(e);
              }}
            >
              <div className="flex-1 overflow-y-auto">
                <FilterFields
                  values={values}
                  categories={categories}
                  brands={brands}
                  idPrefix="m"
                />
              </div>
              <SheetFooter className="border-t pt-4">
                <Button type="submit" className="h-11 w-full" disabled={pending}>
                  {pending ? t("filters.applying") : t("filters.apply")}
                </Button>
                {activeCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-full"
                    onClick={() => {
                      setMobileOpen(false);
                      router.push(clearedHref(values.q));
                    }}
                  >
                    {t("filters.clearAll")}
                  </Button>
                ) : null}
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {/* ── Desktop: an always-visible sidebar ── */}
      <aside className="hidden md:block">
        <form action="/" role="search" className="space-y-4" onSubmit={submit}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("filters.heading")}</h2>
            {activeCount > 0 ? (
              <Button asChild variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs">
                <Link href={clearedHref(values.q)}>{t("filters.clearAll")}</Link>
              </Button>
            ) : null}
          </div>
          <FilterFields values={values} categories={categories} brands={brands} idPrefix="d" />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t("filters.applying") : t("filters.apply")}
          </Button>
        </form>
      </aside>
    </>
  );
}

function FilterIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
