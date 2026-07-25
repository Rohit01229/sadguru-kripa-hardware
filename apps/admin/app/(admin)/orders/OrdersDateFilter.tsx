"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label } from "@hardware/ui";

// Admin orders date-range filter. Intercepts the GET form submit so Apply is a
// client-side soft navigation (RSC fetch) instead of a full-document reload, matching the
// status tabs (which already use next/link). The active `status` is preserved (hidden
// input for the no-JS path, folded into the URLSearchParams for the client path).
// action="/orders" stays as the no-JS fallback.

export function OrdersDateFilter({
  status,
  from,
  to,
  isFiltered,
}: {
  status: string;
  from: string;
  to: string;
  isFiltered: boolean;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const k of ["status", "from", "to"] as const) {
      const s = String(fd.get(k) ?? "").trim();
      if (s) params.set(k, s);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/orders?${qs}` : "/orders"));
  }

  return (
    <form
      action="/orders"
      onSubmit={submit}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      aria-label={t("dateFilter.filterAria")}
    >
      {status && <input type="hidden" name="status" value={status} />}
      <div className="space-y-1 sm:w-44">
        <Label htmlFor="orders-from">{t("dateFilter.from")}</Label>
        <Input id="orders-from" name="from" type="date" defaultValue={from} className="w-full" />
      </div>
      <div className="space-y-1 sm:w-44">
        <Label htmlFor="orders-to">{t("dateFilter.to")}</Label>
        <Input id="orders-to" name="to" type="date" defaultValue={to} className="w-full" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="outline" className="w-full sm:w-auto" disabled={pending}>
          {pending ? t("dateFilter.applying") : tc("actions.apply")}
        </Button>
        {isFiltered && (
          <Button asChild variant="ghost" className="w-full sm:w-auto">
            <Link href="/orders">{tc("actions.clear")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
