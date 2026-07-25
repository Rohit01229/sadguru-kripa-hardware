"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Input, Label, Select } from "@hardware/ui";

// Khata directory filter bar. Intercepts the GET form submit so Apply is a client-side
// soft navigation (RSC fetch) instead of a full-document reload. The parent server
// component normalises the params and passes the current values + aging-bucket options
// down. action="/ledger" stays as the no-JS fallback.

export interface AgingBucketOption {
  value: string;
  label: string;
}

export function LedgerFilterBar({
  q,
  aging,
  outstanding,
  agingBuckets,
  isFiltered,
}: {
  q: string;
  aging: string;
  outstanding: boolean;
  agingBuckets: AgingBucketOption[];
  isFiltered: boolean;
}) {
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");
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
    startTransition(() => router.push(qs ? `/ledger?${qs}` : "/ledger"));
  }

  return (
    <form
      action="/ledger"
      onSubmit={submit}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      role="search"
      aria-label={t("filter.ariaLabel")}
    >
      <div className="space-y-1 sm:w-72">
        <Label htmlFor="ledger-q">{t("filter.search")}</Label>
        <Input
          id="ledger-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t("filter.searchPlaceholder")}
          className="w-full"
        />
      </div>
      <div className="space-y-1 sm:w-44">
        <Label htmlFor="ledger-aging">{t("filter.agingBucket")}</Label>
        <Select id="ledger-aging" name="aging" defaultValue={aging} className="w-full">
          <option value="">{t("filter.anyAge")}</option>
          {agingBuckets.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
      </div>
      <Label
        htmlFor="ledger-outstanding"
        className="flex min-h-[44px] items-center gap-2 font-normal sm:min-h-0 sm:pb-2"
      >
        <Checkbox
          id="ledger-outstanding"
          name="outstanding"
          value="true"
          defaultChecked={outstanding}
        />
        {t("filter.hasOutstandingOnly")}
      </Label>
      <div className="flex gap-2">
        <Button type="submit" variant="outline" className="w-full sm:w-auto" disabled={pending}>
          {pending ? t("filter.applying") : t("filter.apply")}
        </Button>
        {isFiltered && (
          <Button asChild variant="ghost" className="w-full sm:w-auto">
            <Link href="/ledger">{tCommon("actions.clear")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
