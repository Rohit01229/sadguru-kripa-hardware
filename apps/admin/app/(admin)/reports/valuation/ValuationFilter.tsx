"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Label } from "@hardware/ui";

// Stock-valuation filter. Intercepts the GET form submit so Apply is a client-side soft
// navigation (RSC fetch) instead of a full-document reload. The in-stock checkbox only
// emits an entry when checked, so the FormData loop (skipping empties) preserves the
// existing semantics. method="get" stays as the no-JS fallback.

export function ValuationFilter({ inStockOnly }: { inStockOnly: boolean }) {
  const router = useRouter();
  const t = useTranslations("reports");
  const tc = useTranslations("common");
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
    startTransition(() => router.push(qs ? `/reports/valuation?${qs}` : "/reports/valuation"));
  }

  return (
    <form
      method="get"
      onSubmit={submit}
      className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center"
    >
      <Label
        htmlFor="inStockOnly"
        className="flex min-h-[44px] items-center gap-2 font-normal sm:min-h-0"
      >
        <Checkbox id="inStockOnly" name="inStockOnly" value="true" defaultChecked={inStockOnly} />
        {t("valuationFilter.inStockOnly")}
      </Label>
      <Button type="submit" className="h-11 w-full sm:h-9 sm:w-auto" disabled={pending}>
        {pending ? tc("actions.loading") : tc("actions.apply")}
      </Button>
    </form>
  );
}
