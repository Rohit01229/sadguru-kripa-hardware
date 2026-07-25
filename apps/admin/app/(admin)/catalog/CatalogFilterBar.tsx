"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Input, Label, Select } from "@hardware/ui";

// Admin catalog filter bar. Renders the same GET form to /catalog that previously lived
// inline in the server page, but intercepts submit so Apply is a client-side soft
// navigation (RSC fetch) instead of a full-document reload. The parent server component
// still does all data fetching/normalisation and passes the current values + option
// lists down. action="/catalog" remains as the no-JS fallback; `cursor` is always
// dropped so a filter change resets pagination.

export interface CatalogFilterOption {
  id: string;
  name: string;
}

export interface CatalogFilterBarValues {
  q: string;
  categoryId: string;
  brandId: string;
  status: string;
  sort: string;
  inStockOnly: boolean;
}

const SORT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "relevance", labelKey: "filters.sort.relevance" },
  { value: "name_asc", labelKey: "filters.sort.nameAsc" },
  { value: "price_asc", labelKey: "filters.sort.priceAsc" },
  { value: "price_desc", labelKey: "filters.sort.priceDesc" },
  { value: "newest", labelKey: "filters.sort.newest" },
];

export function CatalogFilterBar({
  values,
  categories,
  brands,
  isFiltered,
}: {
  values: CatalogFilterBarValues;
  categories: CatalogFilterOption[];
  brands: CatalogFilterOption[];
  isFiltered: boolean;
}) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      if (k === "cursor") continue;
      const s = String(v).trim();
      if (s) params.set(k, s);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/catalog?${qs}` : "/catalog"));
  }

  return (
    <form
      action="/catalog"
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div className="space-y-1 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="catalog-search">{t("filters.search")}</Label>
        <Input
          id="catalog-search"
          name="q"
          defaultValue={values.q}
          placeholder={t("filters.searchPlaceholder")}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="catalog-category">{t("filters.category")}</Label>
        <Select id="catalog-category" name="categoryId" defaultValue={values.categoryId}>
          <option value="">{t("filters.allCategories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="catalog-brand">{t("filters.brand")}</Label>
        <Select id="catalog-brand" name="brandId" defaultValue={values.brandId}>
          <option value="">{t("filters.allBrands")}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="catalog-status">{t("filters.status")}</Label>
        <Select id="catalog-status" name="status" defaultValue={values.status}>
          <option value="active">{t("filters.statusActiveOnly")}</option>
          <option value="all">{t("filters.statusAll")}</option>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="catalog-sort">{t("filters.sortBy")}</Label>
        <Select id="catalog-sort" name="sort" defaultValue={values.sort}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </Select>
      </div>

      {/* In-stock toggle + actions. The label is a >=44px tap target on mobile. */}
      <label className="flex min-h-[2.75rem] items-center gap-2 text-sm sm:col-span-2 sm:min-h-0 lg:col-span-1">
        <Checkbox name="inStock" value="true" defaultChecked={values.inStockOnly} />
        {t("filters.inStockOnly")}
      </label>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1 lg:justify-end">
        <Button type="submit" className="min-h-[2.75rem] flex-1 sm:flex-none" disabled={pending}>
          {pending ? t("filters.applying") : tc("actions.apply")}
        </Button>
        {isFiltered ? (
          <Button variant="outline" asChild className="min-h-[2.75rem] flex-1 sm:flex-none">
            <Link href="/catalog">{tc("actions.clear")}</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
