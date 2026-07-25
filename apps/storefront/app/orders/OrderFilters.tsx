"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Input, Select } from "@hardware/ui";

// My-orders filter bar (server-side: status + createdAt date range write URL search
// params that the page forwards to @hardware/core listMyOrders -> SQL). A plain GET
// form to /orders, so it works without JS; on mobile the three fields stack to a single
// column and the actions go full-width with >=44px touch targets.

export interface OrderFilterValues {
  status: string;
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
}

// Customer-relevant statuses (labelKey + enum value). Mirrors the order-status map.
const STATUS_OPTIONS: { labelKey: string; value: string }[] = [
  { labelKey: "filters.statusAll", value: "" },
  { labelKey: "filters.statusPendingPayment", value: "PENDING_PAYMENT" },
  { labelKey: "filters.statusPayLater", value: "PAY_LATER" },
  { labelKey: "filters.statusConfirmed", value: "CONFIRMED" },
  { labelKey: "filters.statusPacked", value: "PACKED" },
  { labelKey: "filters.statusDispatched", value: "DISPATCHED" },
  { labelKey: "filters.statusCompleted", value: "COMPLETED" },
  { labelKey: "filters.statusCancelled", value: "CANCELLED" },
];

export function OrderFilters({ values }: { values: OrderFilterValues }) {
  const router = useRouter();
  const t = useTranslations("orders");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = React.useTransition();
  const hasAny = Boolean(values.status || values.from || values.to);

  // Intercept the GET form submit so Apply is a client-side soft navigation (RSC fetch)
  // instead of a full-document reload. action="/orders" remains as the no-JS fallback.
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
      className="mt-6 flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <FormField label={t("filters.statusLabel")} htmlFor="order-status" className="sm:w-44">
        <Select id="order-status" name="status" defaultValue={values.status} className="h-11 sm:h-9">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("filters.fromLabel")} htmlFor="order-from" className="sm:w-40">
        <Input
          id="order-from"
          name="from"
          type="date"
          defaultValue={values.from}
          className="h-11 sm:h-9"
        />
      </FormField>

      <FormField label={t("filters.toLabel")} htmlFor="order-to" className="sm:w-40">
        <Input id="order-to" name="to" type="date" defaultValue={values.to} className="h-11 sm:h-9" />
      </FormField>

      <div className="flex gap-2 sm:ml-auto">
        <Button type="submit" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={isPending}>
          {isPending ? t("filters.applying") : tCommon("actions.apply")}
        </Button>
        {hasAny ? (
          <Button asChild variant="ghost" className="h-11 flex-1 sm:h-9 sm:flex-none">
            <Link href="/orders">{tCommon("actions.clear")}</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
