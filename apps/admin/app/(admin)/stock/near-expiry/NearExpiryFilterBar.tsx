"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label } from "@hardware/ui";

// Near-expiry window filter. Intercepts the GET form submit so Apply is a client-side
// soft navigation (RSC fetch) instead of a full-document reload.
// action="/stock/near-expiry" stays as the no-JS fallback.

export function NearExpiryFilterBar({ withinDays }: { withinDays: number }) {
  const router = useRouter();
  const t = useTranslations("stock");
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const v = String(fd.get("withinDays") ?? "").trim();
    if (v) params.set("withinDays", v);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/stock/near-expiry?${qs}` : "/stock/near-expiry"));
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      action="/stock/near-expiry"
    >
      <div className="space-y-1">
        <Label htmlFor="withinDays">{t("nearExpiryFilter.withinDays")}</Label>
        <Input
          id="withinDays"
          name="withinDays"
          type="number"
          min={1}
          defaultValue={withinDays}
          className="h-11 w-full sm:h-9 sm:w-28"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        className="h-11 w-full sm:h-9 sm:w-auto"
        disabled={pending}
      >
        {pending ? t("nearExpiryFilter.applying") : t("nearExpiryFilter.apply")}
      </Button>
    </form>
  );
}
