"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label } from "@hardware/ui";

// Day-end report date picker. Intercepts the GET form submit so View is a client-side
// soft navigation (RSC fetch) instead of a full-document reload. method="get" stays as
// the no-JS fallback.

export function DayEndFilter({ date }: { date: string }) {
  const router = useRouter();
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const v = String(fd.get("date") ?? "").trim();
    if (v) params.set("date", v);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/reports?${qs}` : "/reports"));
  }

  return (
    <form
      method="get"
      onSubmit={submit}
      className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end"
    >
      <div className="space-y-1">
        <Label htmlFor="date">{t("dayEnd.date")}</Label>
        <Input
          id="date"
          name="date"
          type="date"
          defaultValue={date}
          className="h-11 w-full sm:h-9 sm:w-44"
        />
      </div>
      <Button type="submit" className="h-11 w-full sm:h-9 sm:w-auto" disabled={pending}>
        {pending ? tc("actions.loading") : t("dayEnd.view")}
      </Button>
    </form>
  );
}
