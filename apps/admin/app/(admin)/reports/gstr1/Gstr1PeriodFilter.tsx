"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@hardware/ui";

// GSTR-1 period picker. Intercepts the GET form submit so View is a client-side soft
// navigation (RSC fetch) instead of a full-document reload. method="get" stays as the
// no-JS fallback. The CSV download link stays a raw <a> in the server page (it is a file
// download, not an internal route).

export function Gstr1PeriodFilter({ period }: { period: string }) {
  const router = useRouter();
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const v = String(fd.get("period") ?? "").trim();
    if (v) params.set("period", v);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/reports/gstr1?${qs}` : "/reports/gstr1"));
  }

  return (
    <form method="get" onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Input
        name="period"
        type="month"
        defaultValue={period}
        aria-label={t("gstr1Filter.period")}
        className="h-11 w-full sm:h-9 sm:w-44"
      />
      <Button type="submit" className="h-11 w-full sm:h-9 sm:w-auto" disabled={pending}>
        {pending ? tc("actions.loading") : t("gstr1Filter.view")}
      </Button>
    </form>
  );
}
