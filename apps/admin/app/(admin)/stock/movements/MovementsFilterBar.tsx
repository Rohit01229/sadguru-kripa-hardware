"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label, Select } from "@hardware/ui";

// Movement-ledger filter bar. Intercepts the GET form submit so Apply is a client-side
// soft navigation (RSC fetch) instead of a full-document reload. The parent server
// component fetches the product list + movement-kind options and passes the current
// values down. action="/stock/movements" stays as the no-JS fallback; `cursor` is
// always dropped so a filter change resets pagination.

export interface MovementProductOption {
  id: string;
  name: string;
  sku: string;
}

export interface MovementKindOption {
  value: string;
  label: string;
}

export function MovementsFilterBar({
  productId,
  kind,
  from,
  to,
  products,
  kinds,
  hasFilters,
}: {
  productId: string;
  kind: string;
  from: string;
  to: string;
  products: MovementProductOption[];
  kinds: MovementKindOption[];
  hasFilters: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("stock");
  const tc = useTranslations("common");
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
    startTransition(() => router.push(qs ? `/stock/movements?${qs}` : "/stock/movements"));
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end lg:flex lg:flex-wrap"
      action="/stock/movements"
    >
      <div className="space-y-1">
        <Label htmlFor="productId">{t("movementsFilter.product")}</Label>
        <Select
          id="productId"
          name="productId"
          defaultValue={productId}
          className="h-11 w-full sm:h-9 lg:w-56"
        >
          <option value="">{t("movementsFilter.allProducts")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sku})
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="kind">{t("movementsFilter.kind")}</Label>
        <Select id="kind" name="kind" defaultValue={kind} className="h-11 w-full sm:h-9 lg:w-48">
          <option value="">{t("movementsFilter.allKinds")}</option>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="from">{t("movementsFilter.from")}</Label>
        <Input
          id="from"
          type="date"
          name="from"
          defaultValue={from}
          className="h-11 w-full sm:h-9 lg:w-44"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="to">{t("movementsFilter.to")}</Label>
        <Input
          id="to"
          type="date"
          name="to"
          defaultValue={to}
          className="h-11 w-full sm:h-9 lg:w-44"
        />
      </div>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
        <Button
          type="submit"
          variant="outline"
          className="h-11 w-full sm:h-9 lg:w-auto"
          disabled={pending}
        >
          {pending ? t("movementsFilter.applying") : t("movementsFilter.apply")}
        </Button>
        {hasFilters && (
          <Button asChild variant="ghost" className="h-11 w-full sm:h-9 lg:w-auto">
            <Link href="/stock/movements">{tc("actions.clear")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
