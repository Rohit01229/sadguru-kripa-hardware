"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, SearchIcon } from "@hardware/ui";

/**
 * Search + filter bar for the parties directory.
 *
 * Keeps the section's no-reload navigation: the GET submit is intercepted and turned
 * into a soft navigation, but `method="get"` stays as the no-JS fallback — the same
 * pattern the reports filters use.
 */
export function PartySearch({
  q,
  kind,
  hasBalance,
}: {
  q: string;
  kind: string;
  hasBalance: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(q);

  function go(params: Record<string, string>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    const qs = sp.toString();
    start(() => router.push(qs ? `/parties?${qs}` : "/parties"));
  }

  return (
    <form
      method="get"
      action="/parties"
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: value.trim(), kind, hasBalance: hasBalance ? "1" : "" });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-[14rem] flex-1 space-y-1">
        <Label htmlFor="party-q">Search</Label>
        <div className="relative">
          <SearchIcon
            width={16}
            height={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="party-q"
            name="q"
            className="pl-9"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Name, phone or GSTIN"
          />
        </div>
      </div>
      {kind && <input type="hidden" name="kind" value={kind} />}
      {hasBalance && <input type="hidden" name="hasBalance" value="1" />}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Searching…" : "Search"}
      </Button>
      {(q || hasBalance) && (
        <Button type="button" variant="ghost" onClick={() => { setValue(""); go({ kind }); }}>
          Clear
        </Button>
      )}
    </form>
  );
}
