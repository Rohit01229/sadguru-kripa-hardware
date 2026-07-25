// Locale contract for the admin i18n layer.
// Single source of truth for the supported set, the default, and the cookie name —
// shared by the request config (server) and the LanguageSwitcher (client).
export const locales = ["en", "hi"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie that persists the chosen UI language (path=/, ~1yr). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
