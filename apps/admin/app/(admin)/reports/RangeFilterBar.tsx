"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label, Select } from "@hardware/ui";

// Shared from/to (+ optional grouping) filter bar for the reports added in 19 §11.
// Generalises SalesFilterBar: same no-reload behaviour (intercept the GET submit and
// soft-navigate, keeping method="get" as the no-JS fallback), but parameterised by
// route and grouping options so each new report does not need its own copy.

export interface GroupOption {
  value: string;
  label: string;
}

export function RangeFilterBar({
  action,
  from,
  to,
  groupBy,
  groupOptions,
  hasFilters,
}: {
  /** Route the form navigates to, e.g. "/reports/purchases". */
  action: string;
  from: string;
  to: string;
  groupBy?: string;
  /** Omit to render a date-range-only bar. */
  groupOptions?: GroupOption[];
  hasFilters: boolean;
}) {
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
    startTransition(() => router.push(qs ? `${action}?${qs}` : action));
  }

  return (
    <form method="get" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
      <div className="space-y-1">
        <Label htmlFor="from">{t("salesFilter.from")}</Label>
        <Input id="from" name="from" type="date" defaultValue={from} className="h-11 w-full sm:h-9 sm:w-44" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="to">{t("salesFilter.to")}</Label>
        <Input id="to" name="to" type="date" defaultValue={to} className="h-11 w-full sm:h-9 sm:w-44" />
      </div>
      {groupOptions && groupOptions.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="groupBy">{t("salesFilter.groupBy")}</Label>
          <Select
            id="groupBy"
            name="groupBy"
            defaultValue={groupBy}
            className="h-11 w-full sm:h-9 sm:w-44"
          >
            {groupOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={pending}>
          {pending ? t("salesFilter.running") : t("salesFilter.run")}
        </Button>
        {hasFilters && (
          <Button type="button" variant="outline" asChild className="h-11 flex-1 sm:h-9 sm:flex-none">
            <Link href={action}>{tc("actions.clear")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
