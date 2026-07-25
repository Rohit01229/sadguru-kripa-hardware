"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Input, Label, Select } from "@hardware/ui";

// Stock list filter bar. Intercepts the GET form submit so Filter is a client-side soft
// navigation (RSC fetch) instead of a full-document reload. The parent server component
// fetches the category options and passes the current values down. action="/stock" stays
// as the no-JS fallback. The lowOnly checkbox only emits an entry when checked, so the
// FormData loop (which skips empties) preserves the existing semantics.

export interface StockCategoryOption {
  id: string;
  label: string;
}

export function StockFilterBar({
  q,
  categoryId,
  lowOnly,
  categories,
}: {
  q: string;
  categoryId: string;
  lowOnly: boolean;
  categories: StockCategoryOption[];
}) {
  const router = useRouter();
  const t = useTranslations("stock");
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
    startTransition(() => router.push(qs ? `/stock?${qs}` : "/stock"));
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2"
      action="/stock"
    >
      <Input
        name="q"
        defaultValue={q}
        placeholder={t("filter.searchPlaceholder")}
        aria-label={t("filter.searchAria")}
        className="h-11 w-full sm:h-9 sm:w-72"
      />
      <Select
        name="categoryId"
        defaultValue={categoryId}
        aria-label={t("filter.categoryAria")}
        className="h-11 w-full sm:h-9 sm:w-56"
      >
        <option value="">{t("filter.allCategories")}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
      <Label htmlFor="lowOnly" className="flex min-h-11 items-center gap-2 font-normal sm:min-h-0">
        <Checkbox id="lowOnly" name="lowOnly" value="true" defaultChecked={lowOnly} />
        {t("filter.lowStockOnly")}
      </Label>
      <Button
        type="submit"
        variant="outline"
        className="h-11 w-full sm:h-9 sm:w-auto"
        disabled={pending}
      >
        {pending ? t("filter.filtering") : t("filter.filter")}
      </Button>
    </form>
  );
}
