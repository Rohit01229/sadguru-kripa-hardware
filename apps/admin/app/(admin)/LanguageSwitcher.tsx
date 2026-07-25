"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { cn } from "@hardware/ui";
import { locales, LOCALE_COOKIE, type Locale } from "../../i18n/config";

// Compact EN | हिं language toggle. Writes the NEXT_LOCALE cookie (path=/, ~1yr) and
// calls router.refresh() so server components re-render in the new locale — no full
// page reload, no `[locale]` URL segment. The active locale comes from next-intl's
// useLocale(), which is fed by the request config (cookie) through the provider.
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const LABELS: Record<Locale, string> = {
  en: "EN",
  hi: "हिं",
};

export function LanguageSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const router = useRouter();

  function setLocale(locale: Locale) {
    if (locale === active) return;
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    router.refresh();
  }

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border bg-background p-0.5 text-xs",
        className,
      )}
      role="group"
      aria-label="Language"
    >
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => setLocale(locale)}
          aria-pressed={active === locale}
          className={cn(
            "min-w-9 rounded px-2 py-1 font-medium transition-colors",
            active === locale
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
