"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Input, Label, SearchIcon, XIcon, Spinner, cn } from "@hardware/ui";
import type { PosCustomer } from "./PosClient";

/**
 * Typeahead khata-customer picker for the Counter POS (pakka billing).
 *
 * Replaces the old eager `<Select>` that the page populated with
 * `listCustomers({ limit: 500 })` — which blew past the ledger schema's `.max(200)`
 * cap (ZodError, the page never rendered) and, even capped at 200, would silently omit
 * customers once the store grew past the cap. Instead this queries `/api/customers?q=…`
 * (🔒 customers.read; `q` matches name/phone/gstin) on demand, so it scales to any
 * number of customers and never over-fetches.
 *
 * On pick it hands the full {id, name, phone, gstin} up via `onSelect` so the POS can
 * attach the receivable to that party; clearing returns to walk-in (onSelect(null)).
 */
export function PosCustomerPicker({
  value,
  onSelect,
}: {
  /** Currently selected counter-customer, or null for walk-in. */
  value: PosCustomer | null;
  onSelect: (customer: PosCustomer | null) => void;
}) {
  const t = useTranslations("billing");
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `pos-customer-${listId}`;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // Keep the visible text in sync if the parent clears/sets the selection elsewhere
  // (e.g. reset() after finalizing a sale).
  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value]);

  // Debounced search. Only runs while actively editing (open, no current pick, ≥1
  // char). The AbortController + cleanup make the latest keystroke win and cancel any
  // in-flight request, so out-of-order responses can't clobber the list.
  useEffect(() => {
    const q = query.trim();
    if (!open || value || q.length < 1) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}&limit=10`, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: PosCustomer[] };
        setResults(
          (json.data ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin })),
        );
        setActive(-1);
      } catch {
        if (!ctrl.signal.aborted) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query, open, value]);

  // Close the dropdown when focus/click leaves the widget.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function pick(c: PosCustomer) {
    onSelect(c);
    setQuery(c.name);
    setResults([]);
    setOpen(false);
    setActive(-1);
  }

  function clear() {
    onSelect(null);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    if (value) onSelect(null); // editing invalidates the previous pick
    setOpen(true);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && results[active]) {
        e.preventDefault();
        pick(results[active]!);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const showDropdown = open && (loading || results.length > 0 || query.trim().length >= 1);

  return (
    <div ref={rootRef} className="space-y-1">
      <Label htmlFor={inputId}>{t("customerPicker.label")}</Label>
      <div className="relative">
        <SearchIcon
          width={16}
          height={16}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={inputId}
          ref={inputRef}
          value={query}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          placeholder={t("customerPicker.placeholder")}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          className="pl-8 pr-8"
        />
        {(value || query) && (
          <button
            type="button"
            onClick={clear}
            aria-label={t("customerPicker.clear")}
            className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon width={14} height={14} />
          </button>
        )}
        {showDropdown && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-72 w-full divide-y overflow-y-auto rounded-md border bg-card shadow-md"
          >
            {loading && results.length === 0 ? (
              <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> {t("customerPicker.searching")}
              </li>
            ) : results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">{t("customerPicker.noMatch")}</li>
            ) : (
              results.map((c, i) => (
                <li key={c.id} role="option" id={optionId(i)} aria-selected={i === active}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:min-h-0",
                      i === active && "bg-muted",
                    )}
                  >
                    <span className="min-w-0 truncate font-medium">{c.name}</span>
                    {c.phone && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {c.phone}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
