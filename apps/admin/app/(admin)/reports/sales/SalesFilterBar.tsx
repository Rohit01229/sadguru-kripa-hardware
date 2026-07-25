"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label, Select } from "@hardware/ui";

// Sales-report filter bar. Intercepts the GET form submit so Run is a client-side soft
// navigation (RSC fetch) instead of a full-document reload. method="get" stays as the
// no-JS fallback.

export function SalesFilterBar({
  from,
  to,
  groupBy,
  hasFilters,
}: {
  from: string;
  to: string;
  groupBy: string;
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
    startTransition(() => router.push(qs ? `/reports/sales?${qs}` : "/reports/sales"));
  }

  return (
    <form
      method="get"
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
    >
      <div className="space-y-1">
        <Label htmlFor="from">{t("salesFilter.from")}</Label>
        <Input
          id="from"
          name="from"
          type="date"
          defaultValue={from}
          className="h-11 w-full sm:h-9 sm:w-44"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="to">{t("salesFilter.to")}</Label>
        <Input
          id="to"
          name="to"
          type="date"
          defaultValue={to}
          className="h-11 w-full sm:h-9 sm:w-44"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="groupBy">{t("salesFilter.groupBy")}</Label>
        <Select
          id="groupBy"
          name="groupBy"
          defaultValue={groupBy}
          className="h-11 w-full sm:h-9 sm:w-44"
        >
          <option value="day">{t("salesFilter.optDay")}</option>
          <option value="item">{t("salesFilter.optItem")}</option>
          <option value="category">{t("salesFilter.optCategory")}</option>
          <option value="paymentMode">{t("salesFilter.optPaymentMode")}</option>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={pending}>
          {pending ? t("salesFilter.running") : t("salesFilter.run")}
        </Button>
        {hasFilters && (
          <Button type="button" variant="outline" asChild className="h-11 flex-1 sm:h-9 sm:flex-none">
            <Link href="/reports/sales">{tc("actions.clear")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
