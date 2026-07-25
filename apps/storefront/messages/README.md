# i18n messages — storefront

This app uses **next-intl** (cookie-driven, **no `[locale]` URL segment**). The active
locale is read from the `NEXT_LOCALE` cookie on every request; default `en`, supported
`['en', 'hi']`. Routes are **not** restructured under `app/[locale]/`.

## File layout — one file per area, per locale

```
apps/storefront/
  i18n/
    config.ts      ← locales, defaultLocale, LOCALE_COOKIE, isLocale()
    request.ts     ← getRequestConfig: reads cookie, merges namespaces
  messages/
    en/
      common.json  ← `common` namespace (shell, actions, footer, …)
    hi/
      common.json
```

- **One JSON file = one namespace.** The filename (without `.json`) is the namespace
  key. `common.json` → namespace `common`, referenced as `t('common.<...>')` (or
  `useTranslations('common')` then `t('<...>')`).
- Inside a file, keys may be nested (`shell.signOut`, `footer.blurb`). Reference the full
  dotted path.
- **Every key in an `en` file MUST exist in the matching `hi` file, and vice-versa.**
  Key parity is enforced (see the parity check in the i18n setup report).

## How the request config merges namespaces

`i18n/request.ts` holds a `NAMESPACES` array. For the active locale it dynamically imports
`messages/<locale>/<ns>.json` for each entry and merges them into one messages object
under their namespace key. Components then read `t('<ns>.<key>')`.

## Adding a NEW namespace (fan-out agents do this)

1. Create the pair `messages/en/<area>.json` and `messages/hi/<area>.json` with **identical
   key sets**.
2. Add `"<area>"` to the `NAMESPACES` array in `i18n/request.ts`.
3. Use it:
   - **Server component** (async): `const t = await getTranslations('<area>')` then
     `t('some.key')`. Import from `next-intl/server`.
   - **Client component** (`"use client"`): `const t = useTranslations('<area>')` then
     `t('some.key')`. Import from `next-intl`. The component must be inside
     `<NextIntlClientProvider>` (already wrapping the whole app in `app/layout.tsx`).

## Rules

- Translate **UI chrome only** — nav, labels, buttons, messages, headings.
- **Do NOT translate user-entered data** (product names, categories, descriptions, the
  store name from `getStoreConfig()`, etc.). Those are data, not strings.
- **Printed invoices / receipts stay English.** Do not translate
  `apps/admin/app/(admin)/billing/print/Templates.tsx` or any invoice/receipt rendering.
- Hindi must be natural Devanagari in a hardware-retail register, not machine-literal.

## Switching language

The `LanguageSwitcher` (`app/LanguageSwitcher.tsx`, an `EN | हिं` toggle) writes the
`NEXT_LOCALE` cookie (path=/, ~1yr) and calls `router.refresh()` so server components
re-render in the new locale — no full reload.
