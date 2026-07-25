"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label, Select } from "@hardware/ui";
import { CustomerFilter } from "./CustomerFilter";

// Invoice day-book filter bar. Intercepts the GET form submit so Filter is a client-side
// soft navigation (RSC fetch) instead of a full-document reload. FormData transparently
// picks up status, from, to AND the CustomerFilter hidden `customerId` input — no need to
// rewire each control to local state. method="get" stays as the no-JS fallback; `cursor`
// is always dropped so a filter change resets pagination.

export function InvoiceFilterBar({
  status,
  from,
  to,
  initialCustomerId,
  initialName,
  mayReadCustomers,
  hasFilters,
}: {
  status: string;
  from: string;
  to: string;
  initialCustomerId: string;
  initialName: string;
  mayReadCustomers: boolean;
  hasFilters: boolean;
}) {
  const t = useTranslations("billing");
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
    startTransition(() => router.push(qs ? `/billing/invoices?${qs}` : "/billing/invoices"));
  }

  return (
    <form
      method="get"
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
    >
      <div className="space-y-1">
        <Label htmlFor="inv-status">{t("filterBar.status")}</Label>
        <Select id="inv-status" name="status" defaultValue={status} className="sm:w-40">
          <option value="">{t("filterBar.allStatuses")}</option>
          <option value="ACTIVE">{t("filterBar.statusActive")}</option>
          <option value="CANCELLED">{t("filterBar.statusCancelled")}</option>
        </Select>
      </div>
      {mayReadCustomers && (
        <CustomerFilter
          initialCustomerId={initialCustomerId}
          initialName={initialName}
          className="sm:w-56"
        />
      )}
      <div className="space-y-1">
        <Label htmlFor="inv-from">{t("filterBar.from")}</Label>
        <Input id="inv-from" name="from" type="date" defaultValue={from} className="sm:w-44" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="inv-to">{t("filterBar.to")}</Label>
        <Input id="inv-to" name="to" type="date" defaultValue={to} className="sm:w-44" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1 sm:flex-none" disabled={pending}>
          {pending ? t("filterBar.filtering") : t("filterBar.filter")}
        </Button>
        {hasFilters && (
          <Button type="button" variant="outline" asChild className="flex-1 sm:flex-none">
            <Link href="/billing/invoices">{t("filterBar.clear")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
