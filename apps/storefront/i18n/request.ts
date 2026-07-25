import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

// next-intl request config (no `[locale]` URL segment). The active locale is read from
// the NEXT_LOCALE cookie on every request; unknown/missing values fall back to `en`.
//
// Messages are namespaced one file per area under `messages/<locale>/<area>.json`.
// We eagerly merge every namespace here so components can reference `t('<area>.<key>')`
// without each route loading files itself. To add a namespace, drop a new
// `messages/{en,hi}/<area>.json` pair and add its name to NAMESPACES below.
const NAMESPACES = ["common", "catalog", "cart", "checkout", "orders", "account"] as const;

async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      try {
        const mod = await import(`../messages/${locale}/${ns}.json`);
        return [ns, mod.default] as const;
      } catch {
        // Namespace file not created yet (fan-out in progress) — skip it gracefully so a
        // missing area file never breaks the whole page render.
        return [ns, {}] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
