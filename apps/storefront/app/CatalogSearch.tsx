"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, SearchIcon } from "@hardware/ui";
import type { CatalogFilterValues } from "./catalog-filters-shared";

// Homepage catalog search bar. Renders the same GET form to "/" that previously lived in
// the server CatalogPage, but intercepts submit so searching is a client-side soft
// navigation (RSC fetch) instead of a full-document reload. Every active filter (q,
// categoryId, brandId, priceMin, priceMax, inStockOnly, sort) is preserved via hidden
// inputs AND via the URLSearchParams the client builds — dropping either would silently
// reset the user's filters on search. action="/" remains as the no-JS fallback.

export function CatalogSearch({ values }: { values: CatalogFilterValues }) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

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
    <form className="mt-6 flex gap-2" action="/" role="search" onSubmit={submit}>
      {/* Carry the active filters across a search submit so search doesn't reset them. */}
      {values.categoryId && <input type="hidden" name="categoryId" value={values.categoryId} />}
      {values.brandId && <input type="hidden" name="brandId" value={values.brandId} />}
      {values.priceMin && <input type="hidden" name="priceMin" value={values.priceMin} />}
      {values.priceMax && <input type="hidden" name="priceMax" value={values.priceMax} />}
      {values.inStockOnly && <input type="hidden" name="inStockOnly" value="1" />}
      {values.sort && values.sort !== "relevance" && (
        <input type="hidden" name="sort" value={values.sort} />
      )}
      <div className="relative w-full max-w-md">
        <SearchIcon
          width={16}
          height={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor="catalog-search" className="sr-only">
          {t("search.label")}
        </label>
        <Input
          id="catalog-search"
          name="q"
          type="search"
          defaultValue={values.q}
          placeholder={t("search.placeholder")}
          className="pl-9"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("search.submitting") : t("search.submit")}
      </Button>
    </form>
  );
}
