"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label } from "@hardware/ui";

// Audit-log filter bar. Intercepts the GET form submit so Filter is a client-side soft
// navigation (RSC fetch) instead of a full-document reload. method="get" stays as the
// no-JS fallback; `cursor` is always dropped so a filter change resets pagination.

export function AuditFilterBar({
  action,
  targetType,
  from,
  to,
}: {
  action: string;
  targetType: string;
  from: string;
  to: string;
}) {
  const t = useTranslations("audit");
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
    startTransition(() => router.push(qs ? `/audit?${qs}` : "/audit"));
  }

  return (
    <form
      method="get"
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
    >
      <div className="space-y-1">
        <Label htmlFor="action">{t("filter.action")}</Label>
        <Input
          id="action"
          name="action"
          defaultValue={action}
          placeholder={t("filter.actionPlaceholder")}
          className="w-full sm:w-52"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="targetType">{t("filter.targetType")}</Label>
        <Input
          id="targetType"
          name="targetType"
          defaultValue={targetType}
          placeholder={t("filter.targetTypePlaceholder")}
          className="w-full sm:w-44"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="from">{t("filter.from")}</Label>
        <Input id="from" name="from" type="date" defaultValue={from} className="w-full sm:w-44" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="to">{t("filter.to")}</Label>
        <Input id="to" name="to" type="date" defaultValue={to} className="w-full sm:w-44" />
      </div>
      <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
        {pending ? t("filter.submitting") : t("filter.submit")}
      </Button>
    </form>
  );
}
