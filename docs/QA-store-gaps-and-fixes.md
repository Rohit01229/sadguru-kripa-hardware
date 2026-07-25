# QA: Store Gaps and Fixes

**Date:** 2026-06-29

This document is an honest record of a QA + fix effort across five concern areas of the hardware-store monorepo. Each finding was diagnosed, cross-checked by up to three independent verifiers (vote tallies shown), fixed where confirmed, and re-verified against the running dev servers (storefront `:3000`, admin `:3001`). Where a fix is partial, latent, or deferred, this is stated plainly — nothing is claimed fixed if its verification did not pass.

---

## Executive summary

| Metric | Value |
| --- | --- |
| Total findings | 27 |
| Confirmed (≥1 real vote) | 25 |
| Areas with fixes applied | 5 |

**Per-area verdict (one line each):**

- **Settings save + store name** — All in-scope verifications PASS. The "settings does not save" report was traced to a latent progressive-enhancement (PE) gap, not a server bug; PE was restored and the store name now reads from `StoreConfig`. Two admin-app store-name literals remain (explicitly deferred).
- **Billing** — All verifications PASS. Three `limit:500`-vs-`max(200)` over-cap crashes that took down the POS counter and the invoice day-book were fixed; the POS now uses server-side typeahead search instead of eager over-cap loads.
- **Rate limiting** — All verifications PASS. Five real gaps fixed: missing limiters on token-confirm + webhook + order routes, a spoofable-XFF bypass, and a fail-open/uncaught-throw limiter; failure modes split into explicit fail-open vs fail-closed.
- **State management + load perf** — All verifications PASS (4 of 5 gaps applied without a build; the relationJoins gap is partially shipped behind a capability gate and needs one `prisma generate`). Client state management was reviewed and found correct (no change needed).
- **Navigation without reload** — All verifications PASS. Ten findings: every native-GET filter/search form across storefront + admin was converted to client-intercepted soft navigation (with no-JS fallback preserved); two shared `packages/ui` raw anchors were converted to injected `Link`.

---

## Area 1 — Settings save + store name

### settings-1 — Server-side Settings save pipeline is fully functional (severity: high)

**Votes:** 0/3 (not confirmed as a bug)

**Root cause / finding:** Every persistence layer works with the real seeded OWNER. Direct core `updateStoreConfig({name},{session})` wrote and read back a test name; `PATCH /api/settings` persisted all fields and correctly rejected an invalid `invoicePrefixFormat`; the server action's FormData parsing + Zod schema parse the exact payload the rendered form posts; session/permission resolution returns `settings.write` for the owner; the rendered `/settings` HTML contains all 12 controls and a working submit. Conclusion: the data/action/core/schema/session layers are **not** the cause of a "does not save" symptom.

**Fix applied:** None to core/API/schema/action — they are verified correct. The real symptom was reproduced and addressed as **settings-2** (a client hydration/PE issue), not a server bug.

### settings-2 — Settings form has NO progressive-enhancement fallback (severity: medium)

**Votes:** 1/3 real (confirmed). The dissenting verifiers agreed the markup observation is correct but argued the placeholder `action="javascript:throw…"` is the *standard* output of any `useActionState` form, so it is a latent robustness gap rather than the literal cause of a save failure. The confirming verifier showed the contrast with the login form (direct-action ⇒ real PE endpoint) is real and the fix restores PE.

**Root cause:** In `SettingsForm.tsx` the action handed to `<form action={formAction}>` came from `useActionState` wrapping an **inline async client closure**, so Next rendered the SSR form with `action="javascript:throw new Error('React form unexpectedly submitted.')"` and **no `$ACTION` hidden fields** (no JS-off / pre-hydration submit path). Contrast: `login/page.tsx` passes the server action *directly* into `useActionState` and renders a real `action="" method="POST"` PE endpoint with `$ACTION_REF_1`. Scoping note: the inline-wrapper pattern is app-wide (10+ forms), and the no-PE gap is a real-but-latent defect, not a confirmed functional break — the settings client chunk is healthy.

**Fix applied:**
- `apps/admin/app/(admin)/settings/SettingsForm.tsx` — pass `updateSettingsAction` directly to `useActionState`; moved `router.refresh()` into the existing success-branch `useEffect` keyed on `state.ok`. The inline async wrapper is gone.
- `apps/admin/app/(admin)/ledger/CustomerForm.tsx` — same PE fix applied for consistency (explicitly listed in the refined fix).

**Verification: PASS.** Source confirmed (`useActionState(updateSettingsAction, {})`, `router.refresh()` in the keyed `useEffect`, no inline wrapper). Live: `curl /settings` (OWNER session) now renders `<form action="" encType="multipart/form-data" method="POST">` **with** `$ACTION_REF_1`, `$ACTION_1:0` (bound id `6045a7ac…`), `$ACTION_1:1`, `$ACTION_KEY` hidden fields — identical to the known-good login form. Functional PE replay (no-JS multipart POST) set `name='Verifier Test Shop'` and re-reading `StoreConfig(id='default')` from Neon showed the name persisted; DB restored to `My Hardware Store`. The `ledger/CustomerForm` form likewise now emits a real POST endpoint.

### settings-3 — Store name hardcoded in both app shells (severity: medium)

**Votes:** 3/3 real (confirmed).

**Root cause:** The store name shown in the shells is a string literal rather than read from `StoreConfig.name` (which exists and is seeded as `My Hardware Store`). Verified literals: admin `AdminShell.tsx:154` `Brand()` renders `Hardware Admin` (sidebar + mobile Sheet); storefront `Header.tsx:129/189` and `Footer.tsx:11/61` render `Hardware Store`; storefront `layout.tsx:12` metadata title. Cross-check additionally found two literals the diagnosis missed: `apps/admin/app/layout.tsx:7` (root metadata title) and `apps/admin/app/(auth)/login/page.tsx:47` (`<h1>`).

**Fix applied (read `getStoreConfig()`, fall back to `?? 'My Hardware Store'`):**
- `apps/storefront/app/layout.tsx` — read config in the async `RootLayout`, pass `storeName` into Header and Footer, add async `generateMetadata()`.
- `apps/storefront/app/Header.tsx`, `apps/storefront/app/Footer.tsx` — take `storeName` prop, replace literals.
- `apps/admin/app/(admin)/layout.tsx` — read config, pass `storeName` into `AdminShell`.
- `apps/admin/app/(admin)/AdminShell.tsx` — thread `storeName` into `Brand()` (sidebar + mobile Sheet).

`getStoreConfig()` is exported from `@hardware/core`, has no permission gate, so the unauthenticated shell read is safe; no migration needed.

**Verification: PASS (in-scope).** With the DB temporarily set to `Verifier Test Shop`: storefront `/` rendered 9 occurrences (incl. `<title>`, logo link, footer brand, copyright) and **zero** leftover `Hardware Store` literals; admin `/dashboard` rendered the Brand link twice (sidebar + mobile Sheet) with zero hardcoded `Hardware Admin` in the shell body. DB restored to `My Hardware Store`. The one remaining `Hardware Admin` in the shell path is solely the admin **root** `<title>` (`apps/admin/app/layout.tsx`), explicitly scoped out as a separate follow-up (see Outstanding).

**Files edited (area):** `settings/SettingsForm.tsx`, `ledger/CustomerForm.tsx`, storefront `layout.tsx` / `Header.tsx` / `Footer.tsx`, admin `(admin)/layout.tsx` / `AdminShell.tsx`. No migration.

---

## Area 2 — Billing

### billing-1 — Counter POS `/billing` crashes: `listProducts({limit:500})` exceeds `max(200)` (severity: critical)

**Votes:** 3/3 real (confirmed).

**Root cause:** `billing/page.tsx:33` called `listProducts({limit:500})`. The catalog query schema caps `limit` at `max(200)`, so `listProducts` throws a `ZodError` ('Number must be less than or equal to 200') before returning. The call is inside the page's top-level `Promise.all`, so the rejection propagates out of the async server component and the entire `BillingPage` render fails — only the admin shell renders; no sale can be rung up. Cross-check confirmed line 35 (`listCustomers({limit:500})`) is a second over-cap call on the same page (see billing-3).

### billing-2 — Invoice day-book `/billing/invoices` crashes: `listCustomers({limit:500})` exceeds `max(200)` (severity: critical)

**Votes:** 3/3 real (confirmed).

**Root cause:** `billing/invoices/page.tsx:69` called `listCustomers({limit:500})` (when the user has `customers.read`, which OWNER has). The ledger schema caps `limit` at `max(200)`, throwing a `ZodError` inside the page's `Promise.all`, failing the whole render; the day-book table never renders. Masked for roles without `customers.read` (branch resolves to `{data:[]}`).

### billing-3 — Counter POS also passes `listCustomers({limit:500})` for khata billing (severity: high)

**Votes:** 3/3 real (confirmed).

**Root cause:** `billing/page.tsx:35` `listCustomers({limit:500})` is a second independent over-cap `ZodError` on the POS page for any user with `customers.read`. Both rejections land in the same `Promise.all`, so the page only renders once **both** `limit:500` calls are corrected.

**Fix applied (area):**
- `apps/admin/app/(admin)/billing/page.tsx` — capped the seed product load at `listProducts({limit:200})`; **removed** the eager `listCustomers({limit:500})` khata load entirely (now passes a `mayReadCustomers` flag to `PosClient`); wired the product search box to additionally query `/api/products?q=` so the operator can ring up any product, not just the first page.
- `apps/admin/app/(admin)/billing/PosClient.tsx` — holds the catalog in state, merges server-searched products on pick; product search combines instant local matches with debounced `/api/products?q=` results (AbortController, dedup by id); replaced the customers-array prop with a single `PosCustomer|null` state driven by the typeahead.
- `apps/admin/app/(admin)/billing/PosCustomerPicker.tsx` (new) — typeahead khata-customer picker querying `/api/customers?q=&limit=10` (debounced, abortable), returning the full customer DTO; replaces the eager `<Select>`.
- `apps/admin/app/(admin)/billing/invoices/page.tsx` — no-action / already fixed: the day-book no longer calls `listCustomers({limit:500})`; it uses `getCustomer(sp.customerId)` plus the `/api/customers?q=` typeahead. Left unchanged.

No migration: the `max(200)` caps are correct guardrails; the fix is to stop requesting >200 and use server-side search for unbounded lookup.

**Verification: PASS (all three).**
- **billing-1:** `page.tsx` now calls `listProducts({limit:200})`; `GET /billing` (OWNER session) → 200 with full POS UI ('Counter billing', Kacha/Pakka toggle, 'Add items by name'); zero `ZodError`/`too_big`/`less than or equal to 200` markers. Adversarial check: `GET /api/products?limit=500` still returns 400 `VALIDATION_FAILED` — proving the page renders only because the over-cap call was lowered.
- **billing-2:** `GET /billing/invoices` (OWNER, has `customers.read`) → 200 rendering the real day-book (filter bar + invoice table/empty-state); no error markers. Remaining `limit:500` / `.max(200)` strings in the file are inside comments only.
- **billing-3:** POS page has no live `listCustomers(...)` call; uses `PosCustomerPicker` backed by `/api/customers?q=`. `GET /api/customers?q=&limit=10` (OWNER) → 200. Repo-wide scan confirms the only remaining `limit: 500` occurrences are in code comments documenting the old bug.

**Files edited (area):** `billing/page.tsx`, `billing/PosClient.tsx`, `billing/PosCustomerPicker.tsx`. No migration.

---

## Area 3 — Rate limiting

### ratelimit-1 — verify-email and password-reset CONFIRM endpoints have no rate limiting (severity: high)

**Votes:** 3/3 real (confirmed).

**Root cause:** `POST /api/customer/verify-email` and `POST /api/customer/password/reset` (confirm step) call the flow functions with only Zod validation — neither imports `createAuthLimiter`/`checkLimit`. The token is looked up by `hashToken(rawToken)`, so guesses are unthrottled. The reset-REQUEST endpoint is rate-limited but the far more dangerous reset-CONFIRM is not. (Verifiers noted the 256-bit single-use tokens make brute-force takeover infeasible; the real value is DoS/defense-in-depth — but the gap is real.)

### ratelimit-2 — Razorpay webhook has no rate limiting (severity: medium)

**Votes:** 3/3 real (confirmed).

**Root cause:** `POST /api/webhooks/razorpay` runs `verifyWebhookSignature` (HMAC-SHA256 over the raw body) plus a `log.warn` on every request with no limiter and no IP allowlist — a cheap DoS / CPU-burn / log-flood vector. Correction adopted: the "brute-force the webhook secret" framing is wrong (HMAC with a strong secret is not network-brute-forceable); the real harm is DoS/log-flood. `.env.local` supplies live Upstash creds, so limiters are genuinely active here.

### ratelimit-3 — Order placement and Razorpay order-creation have no per-action rate limiting (severity: low)

**Votes:** 3/3 real (confirmed).

**Root cause:** `POST /api/orders` and `POST /api/payments/razorpay/order` are session-gated (401 without a `CustomerSession`) but have no per-action limiter. `placeOrder()` atomically reserves stock per placement, so an authed+verified customer can spam distinct orders to deplete availability for the TTL window (inventory griefing) and create unbounded gateway orders. Idempotency-Key defaults to a fresh `randomUUID()` so it does not throttle distinct orders.

### ratelimit-4 — Per-IP limiters key off the spoofable X-Forwarded-For first token (severity: medium)

**Votes:** 3/3 real (confirmed).

**Root cause:** Every limiter derived the IP as `x-forwarded-for?.split(",")[0]?.trim() ?? "unknown"`. XFF is attacker-controlled, so a rotating XFF gets a fresh bucket every request, defeating the per-IP limiter. Login is salvaged only by the per-account limiter; register/reset-request had **no** per-account backstop, so XFF rotation fully bypassed their throttling. (Cross-check: the webhook does not belong in the bypass set — it is HMAC-gated, not IP-throttled.)

### ratelimit-5 — Limiter is fail-open: a null limiter silently disables ALL rate limiting (severity: medium)

**Votes:** 3/3 real (confirmed).

**Root cause (refined):** Two opposite failure modes were conflated. (A) **Missing/empty env** → `createAuthLimiter` returns `null` and `checkLimit` returns `{success:true}` ⇒ genuine silent **fail-open** (brute-force protection off); `getRedis()` also caches `null` for the process lifetime. (B) **Upstash outage** → `limiter.limit()` throws and nothing wraps it ⇒ an uncaught throw becomes a 500 / rejected server action = accidental **fail-closed** (availability hit). The security-bypass risk is specifically the missing-env case.

**Fix applied (area):**
- `packages/auth/src/ratelimit.ts` — added a centralized `clientIp(getHeader)` helper that prefers `x-vercel-forwarded-for` / `x-real-ip`, then falls back to the **rightmost** XFF hop (the trusted-proxy entry), instead of the spoofable leftmost token (ratelimit-4). Split failure modes (ratelimit-5): `createAuthLimiter` now emits a loud `console.error` when it returns `null` while `NODE_ENV==='production'`; `checkLimit` wraps `limiter.limit()` in try/catch with an optional `failClosed` flag (credential/token endpoints deny on error; DoS-style limiters stay fail-open).
- `apps/storefront/app/api/customer/verify-email/route.ts` — three limiters before consuming the token: per-IP (10/15m), per-token-hash backstop (5/15m, keyed on `sha256(token)`), and a global ceiling (200/1m), all `failClosed:true`.
- `apps/storefront/app/api/customer/password/reset/route.ts` — same three-limiter `failClosed` pattern.
- `apps/storefront/app/api/webhooks/razorpay/route.ts` — per-IP (60/1m) + global (600/1m) cheap-rejection gate **before** `verifyWebhookSignature`; fail-open by default since the HMAC check remains the real authority.
- `apps/storefront/app/api/orders/route.ts` — per-customer placement limiter (`orders:place:cust`, 20/1m) keyed by `session.customerId`.
- `apps/storefront/app/api/payments/razorpay/order/route.ts` — per-customer limiter (`razorpay:order:cust`, 30/1m).
- `apps/storefront/app/api/customer/login/route.ts` — replaced inline XFF parse with `clientIp()`; `failClosed:true` on both login checks.
- `apps/storefront/app/api/customer/register/route.ts` — `clientIp()` + per-account backstop (`customer:register:acct`, 10/15m) keyed on email.
- `apps/storefront/app/api/customer/password/reset-request/route.ts` — `clientIp()` + per-account backstop (`customer:reset:acct`, 10/15m).
- `apps/admin/app/(auth)/login/actions.ts` — `clientIp()` + `failClosed:true` on both staff-login checks.

**Verification: PASS (all five).** Upstash genuinely active (login returns 429 after 5 attempts).
- **ratelimit-1:** verify-email — 10 distinct bad tokens → 400×10 then 429 (IP cap); same token from 7 rotating IPs → 400×5 then 429 (token backstop). reset-confirm — bad tokens → 400×10 then 429.
- **ratelimit-2:** webhook — 65 forged payloads → 400×60 (BAD_SIGNATURE, HMAC unchanged) then 429 at request 61; gate runs before signature verification, fail-open.
- **ratelimit-3:** with a real verified `CustomerSession`, `/api/payments/razorpay/order` → 400×30 then 429; `/api/orders` → 429 with the standard `RATED_LIMITED` envelope; both 401 unauthenticated.
- **ratelimit-4:** rotating the leftmost XFF token while holding the rightmost trusted hop constant still throttles login at 5/IP; distinct rightmost hops each get their own bucket. register/reset-request per-account backstops fire at 429 on request 11.
- **ratelimit-5:** unit-level against the real exports — outage default `{success:true}` (fail-open, error logged), `failClosed:true` → `{success:false}`; null limiter returns `{success:true}` without throwing; `createAuthLimiter` with cleared env + `NODE_ENV=production` returns `null` and emits the loud `console.error`.

**Files edited (area):** `packages/auth/src/ratelimit.ts` + the eight route/action files above. No migration.

---

## Area 4 — State management + load performance

### state-perf-1 — Prisma `relationJoins` is off — relation includes fan out into N sequential round-trips (severity: high)

**Votes:** 3/3 real (confirmed).

**Root cause (refined):** `schema.prisma` declared only `previewFeatures=["postgresqlExtensions"]`; `relationJoins` is not enabled, so Prisma loads each relation as a separate query instead of a JOIN. The catalog `productInclude` fans out to 5 sequential round-trips. Magnitude correction: warm round-trip ≈ 212ms (not the cold ~480ms originally cited), so steady-state ≈ 1.07s. `listStock` independently fans out to 3 round-trips.

**Fix applied (partial — see Migrations):**
- `packages/db/prisma/schema.prisma` — added `"relationJoins"` to `previewFeatures` (validated with `prisma validate`).
- `packages/core/src/shared/db.ts` (new helper) — `joinStrategy()` returns `{ relationLoadStrategy: "join" }` when the generated client supports it, else `{}` (today's default multi-query behaviour). Support is detected once via a `take:0` probe that issues **zero** DB round-trips when unsupported, and is cached.
- `packages/core/src/catalog/service.ts` — spread `...(await joinStrategy())` into `listProducts`, `getProduct`, `getPublicProduct`.

**Verification: PASS (with caveat).** `schema.prisma` carries `["postgresqlExtensions","relationJoins"]`; the gate is wired into the 3 hot catalog reads. In this locked env (`prisma generate` blocked by the Windows DLL lock), `joinStrategy()` correctly returns `{}` and the reads still succeed (`listProducts`→2 rows, `getPublicProduct`→true); storefront `/` renders the catalog 200. **The JOIN speedup is latent and only activates after `prisma generate`** (see Migrations).

### state-perf-2 — `getDashboard()` runs independent cross-module reads sequentially (severity: high)

**Votes:** 3/3 real (confirmed). Magnitude corrected: warm round-trip ≈ 250ms; the 4.4s figure is cold-start, warm steady-state ≈ 1.9–2.4s.

**Root cause:** `getDashboard()` awaited `dayEnd()` → `lowStock()` → ledger `groupBy` → invoiceLine `groupBy` → product `findMany` strictly serially; these are independent except the final product lookup. `dayEnd()` adds 3 more sequential independent reads.

**Fix applied:**
- `packages/core/src/dashboard/service.ts` — the four independent roll-up reads run in one `Promise.all`; the top-items `product.findMany` stays after (depends on `lineGroups`).
- `packages/core/src/reports/service.ts` — `dayEnd()` parallelizes the three independent day-scoped reads; `baseUnitMapFor()` kept after (derives `productIds` from loaded invoices).

**Verification: PASS.** Source shows `Promise.all([dayEnd(...), lowStock(50), ledgerEntry.groupBy(...), invoiceLine.groupBy(...)])`. Live run returned a correct DTO (`hasToday:true, topItems:4`).

### state-perf-3 — `priceCart` prices the cart with an awaited query per line (N+1) on the checkout path (severity: medium)

**Votes:** 3/3 real (confirmed).

**Root cause:** `priceCart()` looped over `data.items` and awaited `productSaleUnit.findFirst` once per line (K sequential round-trips). The schema has no upper bound on `items.length`, and the checkout page re-POSTs the entire cart on every change.

**Fix applied:** `packages/core/src/orders/service.ts` — replaced the per-line loop with one batched `findMany({where:{id:{in: saleUnitIds}}})` + a Map keyed by `saleUnitId`; line math runs in memory. Critically, the original dual `(id AND productId)` filter is preserved: a mismatched product/saleUnit pair still rejects with `NOT_FOUND` rather than being silently accepted.

**Verification: PASS.** Happy path priced correctly; a `saleUnitId` from a different product still rejected with `NOT_FOUND`; multi-line cart returned correctly. N+1 collapsed to 1 query, integrity preserved.

### state-perf-4 — Slow data fetches block the page body with no `<Suspense>` (severity: medium)

**Votes:** 3/3 real (confirmed). Cross-check: the storefront reads are already parallel, so for that page the missing Suspense boundary is the whole story; the admin dashboard's dominant cost is the serialized round-trips (fixed in state-perf-2).

**Root cause:** Server pages awaited all data before returning the content tree. Route-level `loading.tsx` streams a shell skeleton (fast TTFB) but there is no component-level `<Suspense>` to stream fast UI separately from the slow query.

**Fix applied:**
- `apps/storefront/app/page.tsx` — fast filter reads stay at page level; the slow `listProducts` grid moved into an async child wrapped in `<Suspense fallback={<ProductGridSkeleton/>}>`.
- `apps/admin/app/(admin)/dashboard/page.tsx` — cross-module roll-up wrapped in `<Suspense fallback={<DashboardSkeleton/>}>` via an async `DashboardRollup`.
- `apps/admin/app/(admin)/catalog/page.tsx`, `apps/admin/app/(admin)/orders/page.tsx` — slow results/table moved into async children wrapped in keyed `<Suspense>`.

**Verification: PASS.** Both named pages now have component-level Suspense boundaries (storefront `ProductGrid` keyed wrap; admin `DashboardRollup` wrap). Fast filter-option reads stay at page level.

### state-perf-5 — `listStock` / `lowStock` load relations per-batch and over-fetch 200 rows to filter low-stock in memory (severity: low)

**Votes:** 3/3 real (confirmed). Wording correction: relation loading is **3 batched IN-queries**, not per-row N+1. The genuine latent bug is the low-only path's hardcoded non-pagination (`hasNextPage = !onlyLow && …`, always false) combined with the 200-row over-fetch — once the catalog exceeds 200 products, low-stock count/items silently under-report.

**Root cause:** `listStock()` over-fetched `max(limit*4,200)` rows for the low-stock view and filtered `onHand<=reorderLevel` in JS (a column-to-column compare Prisma's typed API cannot express), with the low-only path never paginating.

**Fix applied:** `packages/core/src/inventory/service.ts` — removed the fixed 200-row window and the always-false low-only pagination. Normal path: clean keyset page (`limit+1` sentinel). Low-only path: scans active products in keyset batches of 200 by id, keeping `onHand<=reorderLevel` matches in JS until one page (+1) is collected or the catalog is exhausted, producing correct `hasNextPage`/`nextCursor`. Generate-free, no relationJoins/raw SQL.

**Verification: PASS.** `listStock({lowOnly:true,limit:5})` returned correct shape with no spurious cursor; `lowStock(50)` consistent. (Result is empty at current 2-product DB scale, but the keyset/paginate code path executed correctly.)

### state-perf-6 — Client state management is idiomatic and correct (severity: low — positive finding)

**Votes:** 0/3 (not a bug; confirmed non-finding).

**Finding:** The storefront cart is an appropriate localStorage-backed React context; catalog/stock/orders filters are URL-as-state with server components fetching data; client islands each have a real interactivity reason; no unnecessary global store. **No change required.**

**Files edited (area):** `schema.prisma`, `shared/db.ts`, `catalog/service.ts`, `dashboard/service.ts`, `reports/service.ts`, `orders/service.ts`, `inventory/service.ts`, storefront `page.tsx`, admin `dashboard/page.tsx` / `catalog/page.tsx` / `orders/page.tsx`. **Migration required for state-perf-1 (see below).**

---

## Area 5 — Navigation without reload

Ten findings (nav-1 … nav-10). With the exception of nav-10 (which two of three verifiers initially read as a non-finding), all are native-GET-form full-reload defects with the identical fix pattern: keep the native `action`/`method=get` for no-JS fallback, intercept `onSubmit` in a `'use client'` component, build `URLSearchParams` from `FormData` (dropping empties, and dropping `cursor` on paginated lists), then `router.push` inside `useTransition` with a pending state. Server components keep all data fetching/normalization and pass values + option lists down.

| ID | Surface | Votes | Verification |
| --- | --- | --- | --- |
| nav-1 | Storefront catalog filters (desktop sidebar + mobile sheet) | 3/3 | PASS |
| nav-2 | Storefront catalog search bar (homepage) | 3/3 | PASS |
| nav-3 | Storefront "My orders" filter bar | 3/3 | PASS |
| nav-4 | Admin catalog filter bar | 3/3 | PASS |
| nav-5 | Admin orders date-range filter | 3/3 | PASS |
| nav-6 | Admin ledger / khata directory filter | 3/3 | PASS |
| nav-7 | Admin stock filter bars (stock list, movements, near-expiry) | 3/3 | PASS |
| nav-8 | Admin billing invoices filter (`method=get`, no action) | 3/3 | PASS |
| nav-9 | Admin audit + reports filters (audit, day-end, sales, valuation, gstr1) | 3/3 | PASS |
| nav-10 | Shared `packages/ui` raw anchors cause full reloads | 1/3 real | PASS |

**nav-10 note:** The original diagnosis claimed "no action needed" (all internal nav is `next/link`). One verifier refuted this: its sweep excluded `packages/`, where `page-header.tsx:39` (breadcrumb links) and `stat-card.tsx:51-52` (clickable KPI tiles) render raw `<a href>` for internal routes — used on 5+ admin pages and the dashboard. These were fixed. The gstr1 CSV anchor (`/api/reports/gstr1?…&format=csv`, a file download) was correctly left as a raw `<a>`.

**Fixes applied (selected):**
- New `'use client'` filter components: `CatalogSearch.tsx`, admin `CatalogFilterBar.tsx`, `OrdersDateFilter.tsx`, `LedgerFilterBar.tsx`, `StockFilterBar.tsx`, `MovementsFilterBar.tsx`, `NearExpiryFilterBar.tsx`, `InvoiceFilterBar.tsx` (wraps the `CustomerFilter` island so its hidden `customerId` is submitted), `AuditFilterBar.tsx`, `DayEndFilter.tsx`, `SalesFilterBar.tsx`, `ValuationFilter.tsx`, `Gstr1PeriodFilter.tsx`.
- In-place onSubmit interception: storefront `CatalogFilters.tsx` (both desktop + mobile forms), `orders/OrderFilters.tsx`.
- `packages/ui/src/components/page-header.tsx` and `stat-card.tsx` — added an optional injected `linkComponent` prop (framework-agnostic; no `next/link` dependency added to `packages/ui`); apps inject `Link`. Threaded `linkComponent={Link}` on the dashboard StatCards (`/stock?lowOnly=true`, `/ledger`) and on PageHeader breadcrumbs in `catalog/masters`, `catalog/import`, `catalog/[id]`, `catalog/new`, `ledger/[id]`.

**Verification: PASS (all ten).** Each affected route returns 200 with the native form's no-JS fallback preserved and the RSC payload referencing the new client filter module (or the injected `Link` rendering). The gstr1 CSV link remains a raw file-download anchor.

**Files edited (area):** 36 files (13 new client filter components + 2 in-place storefront forms + 2 `packages/ui` components + 7 admin server pages threading `linkComponent` + the parent server pages swapping in the new filter components). No migration.

---

## Migrations required

**state-perf-1 — Prisma `relationJoins` regeneration (no SQL / data migration).**

The schema flag and the capability-gated `joinStrategy()` helper are already shipped and safe. One mechanical regeneration step remains, deferred because `prisma generate` is blocked in this environment (the running dev server holds the Windows query-engine DLL → EPERM). With the dev server **stopped**:

1. Confirm `packages/db/prisma/schema.prisma` carries `previewFeatures = ["postgresqlExtensions", "relationJoins"]` (already done).
2. Run `pnpm --filter @hardware/db db:generate` (i.e. `prisma generate`).
3. After regeneration, `joinStrategy()`'s one-time client-side probe passes and the three catalog reads (`listProducts`/`getProduct`/`getPublicProduct`) automatically collapse from 5 sequential round-trips to a single JOIN — no further code change.
4. Sanity-check the JOIN plan as the catalog grows (one-to-many `saleUnits` are aggregated via a correlated JSON subquery).

Until regeneration, `joinStrategy()` returns `{}` and the app keeps today's correct multi-query behaviour (verified: no crash, HTTP 200, correct data). No `prisma migrate` is needed — `relationJoins` is a client/query-planning feature only.

---

## Outstanding / not fixed

No verification **failed** — every applied fix passed its check. The items below are partial fixes, deferred sub-items, and unresolved scope flagged by the critic.

- **settings-2 is only ~20% closed.** The PE fix was applied to `SettingsForm.tsx` and `ledger/CustomerForm.tsx` only. Eight more forms still carry the PE-killing inline-async-closure pattern (`useActionState(async (prev, fd) => {...})`) and still render `action="javascript:throw…"` with no `$ACTION` fields: `catalog/ProductForm.tsx:60`, `stock/grn/GrnForm.tsx:48`, `stock/suppliers/SupplierForm.tsx:23`, `stock/adjustments/StockForms.tsx:62`, `catalog/[id]/ProductActions.tsx:35`, `catalog/[id]/PriceSlabEditor.tsx:32`, `ledger/[id]/LedgerActions.tsx:20`, `catalog/masters/MasterForms.tsx:19`. These are create/mutate forms (product create, GRN receive, supplier create, stock adjust, price-slab edit, ledger payment) where PE robustness matters most. (Note: several of these bind a route param into the action via the closure, so restoring PE needs `action.bind(null, id)` rather than a trivial direct pass — a broader, riskier refactor, deliberately deferred.)
- **settings-3 has two in-diagnosis sub-items still unresolved** (the diagnosis flagged both as "BEYOND DIAGNOSIS SCOPE / separate follow-up"):
  - `apps/admin/app/layout.tsx:7` metadata title is still the hardcoded literal `Hardware Admin` (root layout is non-async/static — needs an async `generateMetadata()` calling `getStoreConfig()`, as the storefront layout fix did).
  - `apps/admin/app/(auth)/login/page.tsx:47` still renders the hardcoded `<h1>Hardware Admin</h1>` (login is outside the `(admin)` group so gets no shell `storeName` prop — needs the page made async reading `getStoreConfig()`, or `storeName` passed another way).
- **state-perf-1 speedup is latent, not realized** until the `prisma generate` step in Migrations runs. Anyone validating "is the catalog faster now?" in this environment will see no change.

---

## Missed by diagnosis — pick up next

- **Settings input validation surface was never audited.** Settings save has no maxlength/size guard surfaced to the operator, and the multi-line fields (`address`, `bankDetails`, `invoiceTerms`) plus `logoKey` are persisted verbatim and later rendered onto printed invoices/receipts via `Templates.tsx` and the POS print path. Confirm `updateStoreConfigSchema` has length caps — a very large paste bloats every invoice render and an unsanitized value could break print layout. The diagnosis covered PE and store-name but not the settings INPUT validation.
- **Duplicate `getStoreConfig()` per storefront request (perf).** `apps/storefront/app/layout.tsx` now calls `getStoreConfig()` twice per request — once in `generateMetadata()` and once in the `RootLayout` body — an avoidable duplicate DB round-trip on every storefront page load. Memoize with React `cache()` so the shell + metadata share one read.
- **POS → `/api/products?q=` is unauthenticated and unthrottled (billing × ratelimit).** The POS now fires `GET /api/products?q=` on every debounced keystroke (`PosClient.tsx:217`). That route is the storefront-safe public catalog endpoint (no staff session, read-only — likely OK) but has **no rate limiting**. This new client→API dependency introduced by the billing fix is not itself rate-limited.
- **The over-cap class of bug was fixed pointwise, not guarded.** Only `billing/page.tsx` and `billing/invoices/page.tsx` were corrected; no shared `MAX_LIST_LIMIT = 200` constant was introduced as the refined fix recommended. Any other caller of `listProducts`/`listCustomers`/`listInvoices` with a literal `limit > 200` would crash identically. A repo-wide grep for `listProducts({ limit:` / `listCustomers({ limit:` / `listInvoices({ limit:` > 200 would confirm none remain.
- **Billing modal mutation flows not audited for no-reload.** The `InvoiceActions` credit-note form (`billing/invoices/[id]/InvoiceActions.tsx:200`) and cancel form (`:125`) are inside a modal and were outside the nav sweep. Confirm modal close + list refresh after a credit note happens without a full reload.
- **ratelimit-4 part 2 appears incomplete for register / reset-request.** Only verify-email and reset-confirm got the token/global backstops. `register/route.ts` and `password/reset-request/route.ts` got the per-email per-account backstop in the area fix (good), but if `x-vercel-forwarded-for`/`x-real-ip` are absent on a non-Vercel/edge path, the hardened `clientIp()` can still fall back to a shared/spoofable value — re-confirm the per-email secondary limiter genuinely closes XFF-rotation enumeration on both routes.

---

## Regression risks

- **state-perf-1 / `joinStrategy()` — perf win is latent, fallback is safe.** Because the dev server holds the old generated client (no `relationLoadStrategy` support; `prisma generate` blocked by the DLL lock), `joinStrategy()` currently returns `{}` and the app silently runs the **old** multi-query path. The schema flag + helper are correct and safe (graceful try/catch on `PrismaClientValidationError`), but the speedup only lands after a future `prisma generate` at deploy time. Ensure that step runs or the win never materializes.
- **Billing `PosClient.tsx` non-null-assertion crash hazard.** Cart/preview/print math indexes `byId.get(l.productId)!` and `p.saleUnits.find(...)!` with non-null assertions. The new flow merges server-searched products into `catalog` state on `addProduct`, but a `useEffect` resets `catalog` to the `products` prop whenever the prop identity changes — a parent re-render passing a fresh `products` array would **wipe merged server-search products out of the catalog while their lines remain in the cart**, making `byId.get()` return undefined and the `!` assertion throw at render (POS crash mid-bill). Verify the parent never passes a fresh `products` array after items are added.
- **Rate-limit fail-closed on verify-email + reset-confirm = new availability dependency.** Both confirm routes pass `failClosed:true` on three limiters. During an Upstash outage, `checkLimit` returns `{success:false}` ⇒ the route 429s, making email verification AND password-reset completion impossible for all users. This is the intended security tradeoff (per ratelimit-5), but it is a genuine new availability dependency on Upstash for account recovery — add an ops note/alert so a Redis outage is recognized as "users cannot reset passwords" rather than a mysterious 429.
- **`clientIp()` bucket-collision in non-Vercel topologies.** The hardened extraction uses the rightmost XFF hop / `x-vercel-forwarded-for` / `x-real-ip`. In any deployment not behind exactly one trusted proxy appending the rightmost entry (local dev, a different hop count, or a CDN that prepends), the rightmost hop may be a private/proxy IP shared across all users → every client collapses into one bucket and legitimate users throttle each other (false 429s on login/register). Correct for Vercel (confirmed by `vercel.json`); validate in the actual prod topology before trusting it.
- **Store-name read now on every page (including login) — wrap in try/catch.** `getStoreConfig()` is now called in the unauthenticated storefront + admin shells on every request, including the login page. The `?? 'My Hardware Store'` fallback only covers a `null` result, not a thrown error. If `getStoreConfig` ever throws (StoreConfig row missing / DB blip), the root async layout rejects and the whole app shell fails to render (white screen) — including the login page needed to fix it. Wrap the shell `getStoreConfig()` in a try/catch returning the default.
