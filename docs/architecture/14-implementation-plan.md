# v1 Implementation Plan — Hardware Store (feature behaviour)

> **Reality baseline (2026-06-28).** This repo is **scaffolded, not behaviour-complete**. Cross-checked against the live tree: Turborepo + pnpm workspace builds (`package.json`, `turbo.json`, `pnpm-workspace.yaml`); `packages/config`/`core`/`auth`/`ui` lint + typecheck clean with **20 unit tests passing** (15 core + 5 auth); `packages/db/prisma/schema.prisma` holds the **foundation subset only** (auth realms, RBAC, AuditLog, VerificationToken, Unit/Category/Brand/Product/ProductSaleUnit/ProductStock/StockMovement, InvoiceCounter, StoreConfig); `apps/admin` + `apps/storefront` are **authored skeletons** (next.config, zod env, middleware, layout, one dashboard slice calling `core.listProducts()`, healthz/readyz, login UI). **No product behaviour exists**: every DB-touching core service is a stub string (`catalog.listProducts` returns `[]`; `inventory`/`billing` export literal `*_PATTERNS` constants — see `packages/core/src/{inventory,billing}/service.ts`); there is **no generated Prisma client, no `.env`, no migration, no seed, no node_modules**, and `.git` has been removed. The pure primitives that *are* implemented and tested — `uom.toBaseQty`, `tax.computeLineTax`/`backCalcTaxable`, `rbac.can`/`requirePermission`, `money`, `billing.financialYear`/`formatInvoiceNo`, `logger.redact` — are the load-bearing logic this plan wires into the database. This plan builds the v1 product loop on top of that scaffold.

This is the **feature-behaviour** plan. It consumes the design docs as the contract — solution shape (`02`), the hard patterns (`03`: UoM §4, atomic stock §5, kacha zero-trace §6, gapless numbering §7, GST §8, Razorpay idempotency §9, jobs §10, search §11), the full schema (`13`), the API surface (`04`), and the RBAC matrix (`10`) — and turns them into ordered, independently-shippable **vertical slices**. The scaffolding plan (`11`) delivered the inert base (Phases 1–8); this plan owns Phases 9–11 **and** the feature build that those phases assumed.

Architecture reminder (so nothing here is over-built): we are a **Next.js App Router modular monolith on Turborepo + Prisma + PostgreSQL (Neon)** — ADR-0001. There are **no Durable Objects, no service mesh, no realtime materializers, no read-model projections**. The "authoritative mutation" is a `prisma.$transaction` inside a `packages/core` service; the "dual guard" is **Zod at the transport layer (server action / route handler) + `requirePermission` in core + an `audit()` write in the same transaction**; "live update" is a server action + `revalidatePath`/refetch, not a socket.

---

## Chunk 0 — Recommendation

Build v1 as **two foundation slices (S0–S1) then seven ordered feature slices (S2–S8)** on top of the inert scaffold, in this exact order:

0. **S0 — Run it + grow the schema + seed skeleton.** Provision Neon, create `.env`, `pnpm install`, grow `schema.prisma` from the foundation subset to the **full `13` model**, run the first migration, add `pg_trgm` GIN indexes, confirm both apps boot. No product behaviour — persistence foundation only.
1. **S1 — Auth + RBAC + audit + the shared service kernel.** Install Auth.js, finish both realm configs, DB-session strategy, email-verify/password-reset, login rate-limit; resolve session→permissions; seed `OWNER` + all permission keys + first staff user + `StoreConfig`; implement the **shared transactional kernel** every slice reuses: `decrementStock`/`reserve`/`release` (03 §5), `nextInvoiceNo` (03 §7), and `audit()` (10 §7). Still no end-user feature — the spine everything hangs on.
2. **S2 — Catalog + UoM + Pricing.** Product CRUD (base unit + N sale units + factors, HSN, GST rate, MRP/sale price), categories/brands/units, quantity-break slabs, search, CSV import. Nothing can be stocked or sold until products exist.
3. **S3 — Inventory / Stock.** GRN stock-in + suppliers, manual adjustments + reasons, opening stock, returns, batches + expiry, low-stock alerts, stock reports. Stock must exist before anything sells it. Exercises the atomic decrement kernel for the first time.
4. **S4 — Counter Billing (Kacha + Pakka).** The shop's daily core: POS UI, kacha zero-trace, one-click convert→pakka, pakka full GST invoice with gapless numbering, payment modes incl. khata/part-payment, print templates.
5. **S5 — Khata ledger + Returns / Credit Notes + Cancel.** Receivables, aging, payments, reminders; credit notes vs pakka (own gapless series); invoice cancel/amend. Closes the financial-correction loop billing opened.
6. **S6 — Ecommerce / Orders.** Storefront catalog/search/cart/checkout, customer accounts, reserve-on-placement (TTL), Razorpay (hosted checkout + signed webhook + idempotency) + pay-later, admin fulfilment accept→pack→dispatch with **pakka-on-dispatch**, delivery/pickup + fees, order notifications.
7. **S7 — Cross-cutting: Reports + Dashboard + Jobs + Settings + Backups.** GSTR-1/HSN export + sales/day-end/valuation reports, dashboard, Vercel-Cron→QStash jobs (reservation-expiry, khata reminders, day-end, near-expiry/low-stock), `StoreConfig` admin screen, encrypted `pg_dump`→R2 backups, security finishing.
8. **S8 — Quality, CI/CD & go-live.** Integration tests (Dockerised Postgres) for `decrementStock` + gapless numbering, Playwright e2e for the key slices, GitHub Actions (lint/typecheck/test/build + audit/gitleaks/Dependabot), Dockerfiles, then hosting/domain/TLS/live keys, UAT with the owner, backup schedule + runbook.

Each feature slice (S2–S8) ships the **full vertical**: **Zod-validated transport (server action or route handler) → `requirePermission` guard → `packages/core/<module>/service.ts` running one `prisma.$transaction` → `audit()` on sensitive ops → typed DTO → admin/storefront UI**. No app ever imports `packages/db` (03 §1); transactions are opened only in core (03 §2).

---

## Chunk 1 — Why this order

Each slice unblocks the next; none can be reordered without breaking a hard dependency.

- **S0 first, always.** Every other slice writes through the Prisma client, which does not exist until `db:generate` runs against a migrated database. The full schema is grown here (not incrementally per slice) because `13` already settled the shape — growing it once avoids a migration per feature and lets core services typecheck against real models from S1 onward. (`packages/db` typecheck is engine-dependent and only passes post-`generate` — see `SCAFFOLDING.md`.)
- **S1 before any feature.** The `requirePermission` guard, `audit()` writer, `decrementStock`/`nextInvoiceNo` kernel, and session resolution are consumed by **every** mutation in S2–S8. Building them once means features call them instead of re-deriving them. RBAC seed must exist or every guarded mutation 403s. Auth must work or there is no `session` to guard against.
- **S2 (catalog) before S3/S4.** There is no stock to receive and no line to bill until a `Product` with a `baseUnit` and a `ProductSaleUnit` exists. UoM conversion (`toBaseQty`) and price resolution are catalog/pricing concerns that billing and orders both consume.
- **S3 (stock) before S4/S6.** A sale decrements stock; selling against a product with no `ProductStock` row is meaningless. S3 also exercises the atomic decrement kernel (S1) for the first time on the loosest path (GRN is `+`, adjustments are signed) before the latency- and correctness-critical billing path depends on it.
- **S4 (billing) before S5.** Credit notes and cancellations *correct* pakka invoices; there must be invoices to correct. Khata receivables are posted **by** pakka/khata sales — the ledger has nothing to age until billing writes to it.
- **S5 before S6's invoice path is fully trusted.** Orders generate a pakka invoice on dispatch (delegating to Billing, 03 §3) and online returns issue credit notes / refunds — both reuse S4+S5 machinery. Building the counter path first means the order path grafts onto proven code rather than inventing a parallel one.
- **S6 before S7's reports are meaningful.** GSTR-1, day-end and valuation aggregate over invoices/credit-notes/movements from S4–S6; the dashboard surfaces today's sales + dues + low-stock from all prior slices. Background jobs (reservation-expiry, khata reminders) operate on order/ledger rows that only exist after S5/S6.
- **S8 last.** CI gates everything that came before; e2e/integration tests assert against the full mutation surface; go-live (paid hosting, live Razorpay keys, real GSTIN/StoreConfig, UAT) can only happen once the product is feature-complete and green. **No green CI + no UAT sign-off ⇒ no go-live flag.**

---

## Chunk 2 — Current reality (live repo today)

What exists:

```txt
- Root workspace: package.json (turbo scripts: build/dev/lint/typecheck/test/test:e2e/db:generate/db:migrate),
  turbo.json, pnpm-workspace.yaml, .nvmrc (22), .npmrc, .env.example. NO node_modules. .git removed.
- packages/config: tsconfig.base, eslint.base/config/boundaries, prettier, tailwind.preset — DONE.
- packages/db: prisma/schema.prisma = FOUNDATION SUBSET only (see baseline); src/client.ts + src/index.ts;
  .env.example. NO generated client, NO migration, NO .env, NO seed.
- packages/core: shared/{errors,money,uom,tax,rbac,logger,types}.ts (+ tests, 15 passing);
  billing/numbering.ts (financialYear + formatInvoiceNo, tested); catalog/service.ts (listProducts -> []);
  inventory/service.ts (export INVENTORY_PATTERNS string); billing/service.ts (export BILLING_PATTERNS string).
  rbac.ts PERMISSIONS = the 33 v1 permission keys (10 §4). NO DB-touching service is implemented.
- packages/auth: password.ts (argon2id), tokens.ts, ratelimit.ts (+ tests, 5 passing);
  nextauth/{staff,customer}.config.ts authored (typecheck post-generate). NO next-auth installed yet.
- packages/ui: Button + cn — DONE.
- apps/admin: next.config.ts (transpilePackages + headers/CSP), env.ts (zod), middleware.ts (coarse cookie gate
  on hw.staff.session), app/layout.tsx, app/(admin)/dashboard/page.tsx (calls core.listProducts()),
  app/(auth)/login/page.tsx, app/api/{healthz,readyz}/route.ts. Boots after install + generate + DB.
- apps/storefront: next.config.ts, env.ts, layout.tsx, app/page.tsx (catalog), app/api/healthz/route.ts. Same prereqs.
```

What does not exist yet (the whole product loop):

```txt
- Generated Prisma client; packages/db/.env; the initial migration; pg_trgm GIN indexes; the seed.
- Grown schema models: PriceSlab, Batch, Reservation, Supplier/GoodsReceipt/GrnLine/SupplierPayment,
  Customer/Address/LedgerEntry, Invoice/InvoiceLine/Payment/CreditNote/CreditNoteLine/CreditNoteCounter,
  Order/OrderLine, ProcessedWebhook. (Customer/CustomerAccount exist in foundation; the rest are 13 §5-§9.)
- Every DB-touching core service: catalog CRUD, pricing.resolvePrice, inventory.decrementStock/reserve/release/grn/
  adjust/return, billing.finalizePakka/finalizeKacha/nextInvoiceNo/cancel/creditNote, ledger.post/recordPayment/aging,
  orders.place/markPaid/accept/pack/dispatch/complete, reports.*, import.*, audit().
- Session->permission resolution (resolve roles to permission keys per request) and the real requirePermission wiring.
- next-auth install + realm wiring; email-verify/password-reset flows; auth rate-limit/lockout on endpoints.
- Razorpay (order create + webhook verify + idempotency); R2 image/PDF uploads; QStash/Cron jobs.
- All admin UI (catalog, GRN, POS, ledger, orders, reports, settings) and storefront UI beyond the catalog stub.
- StoreConfig row + admin screen; backups; CI/CD; Dockerfiles; integration/e2e tests; the seed.
```

Therefore:

```txt
- Testable now: the 20 unit tests; turbo build/lint/typecheck of config/core/auth/ui; app skeletons boot ONLY after
  install + a real DB + db:generate.
- NOT trustable yet: any feature flow. Every endpoint in 04 is target behaviour, not shipped. No permission is enforced
  end-to-end, no invoice can be created, no stock can move. Do not claim a feature done until its slice's acceptance passes.
```

---

## Chunk 3 — Scope

**In scope (v1 = the `[M]` must-haves in `REMAINING-WORK.md` + the locked decisions in `02-feature-proposal.md`):**

```txt
1. Catalog + multi-UoM + quantity-break pricing + CSV import + search (S2).
2. Stock: GRN + suppliers, adjustments, opening stock, returns, batches/expiry, low-stock alerts, stock reports (S3).
3. Counter billing: kacha zero-trace, convert->pakka, pakka GST invoice with gapless numbering, payment modes
   incl. khata/part-payment, manual rate override, round-off, thermal + A4/A5 print (S4).
4. Khata ledger + dues aging + reminders; credit notes vs pakka; invoice cancel/amend (S5).
5. Ecommerce B2C+B2B: storefront, cart, checkout, customer accounts, reserve-on-placement, Razorpay + pay-later,
   delivery/pickup + fees, pakka-on-dispatch, order notifications (S6).
6. Cross-cutting: GSTR-1 + HSN export, sales/day-end/valuation reports, dashboard, background jobs, StoreConfig
   admin, audit log + viewer, encrypted backups, security finishing (S7).
7. Quality + CI/CD + go-live: integration/e2e tests, GitHub Actions, Dockerfiles, hosting/domain/TLS, UAT, runbook (S8).
```

**Out of scope for v1 (hard boundaries — deferred by the locked decisions, not "later in this plan"):**

```txt
- e-Invoice / IRN (turnover < Rs 5 cr; 02 Decision 6) — designed as a switch-on Billing extension, NOT built.
- e-Way bill generation (>Rs 50k) — nice-to-have, endpoint TBD; not core v1.
- Separate wholesale price lists / customer-specific pricing — B2B = universal quantity-break slabs only (02 Decision 5).
- RFQ/quote, saved quotation/estimate, delivery challan, material calculators, coupons — all [N], not v1.
- Multi-store / multi-warehouse; product variants (size/colour/gauge); barcode label printing — [F].
- WhatsApp notifications (phase 2); SMS only where MSG91 DLT templates are approved; email (Resend) is the v1 primary.
- Owner 2FA (TOTP scaffolded in schema, off in v1); OpenTelemetry tracing [N].
- Cashier/Stock-Manager/Accountant roles — model accommodates them (data-driven RBAC), but v1 ships OWNER only (10 §2).
```

**What an implementer must NOT do (invariants — enforced by the eslint import-boundary config in `packages/config` + review):**

```txt
- Do NOT import packages/db from any app. Apps call packages/core (+ packages/auth) only (03 §1).
- Do NOT import the Prisma client anywhere except packages/core (and packages/auth for the adapter's own tables).
- Do NOT put React/Next imports in packages/core — it stays plain TS (03 §1, for later service extraction).
- Do NOT open a transaction in a server action / route handler. prisma.$transaction lives in the core service (03 §2).
- Do NOT branch on role name (`if role === 'OWNER'`). Always can(session, key) / requirePermission (10 §3, §6).
- Do NOT persist anything for a kacha sale except one StockMovement{kind: KACHA_OUT}. No invoice/value/cash/customer/
  tax/ledger row (03 §6, 13 §8). The kacha cart is client/session-transient; "convert" calls finalizePakka, never an upgrade.
- Do NOT hard-delete a financial record. Invoices/credit-notes/ledger are cancelled or corrected, never deleted (13, 07 §10).
- Do NOT mint an invoice number outside the counter UPDATE...RETURNING inside the invoice transaction (03 §7). Only Billing
  mints numbers and tax rows; only Inventory mutates stock (03 §3).
- Do NOT use float for money or quantity. Prisma Decimal in the DB; integer paise on the API wire; superjson for Decimal
  across server actions (13 conventions, 04 §2).
- Do NOT trust the client for authz. UI hiding is cosmetic; the core guard is the gate (10 §5).
- Do NOT mark an order paid from the browser redirect. The signed Razorpay webhook is the source of truth, idempotent on
  event.id via ProcessedWebhook (03 §9, 04 §8.6).
- Do NOT skip the audit() write on a sensitive/financial op (10 §7 lists the minimum set), in the SAME transaction.
```

---

## Chunk 4 — Slice S0: Run it + grow the schema + seed skeleton

**Maps to:** `REMAINING-WORK.md` §0 + §1 (schema growth); `START-HERE.md` Steps 1–4; `13` Phase-3→full; `03` §11 (search indexes).

S0 is persistence foundation only — no capability, no UI behaviour. It makes the Prisma client real so S1+ can typecheck and run against actual models.

### Build
1. **Tooling + install.** `corepack enable`; from root `pnpm install`. Confirm `turbo build` still green for config/core/auth/ui.
2. **Hosted Postgres.** Create a free Neon project; write `packages/db/.env` with pooled `DATABASE_URL` + direct `DIRECT_URL` (provider specifics in `packages/db/README.md`). Keep it gitignored.
3. **Grow `packages/db/prisma/schema.prisma`** from the foundation subset to the **full `13` model** — add: `PriceSlab`, `Batch`, `ReservationStatus`+`Reservation`, `Supplier`/`GoodsReceipt`/`GrnLine`/`SupplierPayment`, `Address`, `LedgerEntryType`+`LedgerEntry`, `InvoiceStatus`/`PaymentMode`+`Invoice`/`InvoiceLine`/`Payment`, `CreditNoteCounter`/`CreditNote`/`CreditNoteLine`, `OrderStatus`/`FulfilmentType`/`PaymentStatus`+`Order`/`OrderLine`, `ProcessedWebhook`. Wire the relations already declared in `13` (e.g. `Customer.addresses/invoices/orders/ledger`, `Product.batches`, `Order.reservations`). Keep the foundation models verbatim.
4. **Generate + migrate.** `pnpm --filter @hardware/db db:generate` then `db:migrate:dev` (name it `init_full_schema`). Confirm `pnpm --filter @hardware/db typecheck` passes (needs the generated client).
5. **Search indexes.** Add a follow-up migration with raw SQL: `CREATE EXTENSION IF NOT EXISTS pg_trgm;` + GIN trigram indexes on `Product.name`, `Product.sku`, `Brand.name` (03 §11).
6. **Seed skeleton.** Add `packages/db/prisma/seed.ts` + a `db:seed` script (idempotent/upsert): for now just `StoreConfig{ id: "default" }` with placeholder name/homeState so apps that read it don't crash. (RBAC + owner user seed lands in S1; sample catalog in S2.)
7. **Boot check.** `pnpm dev` → admin :3001 dashboard renders "Products in catalog: 0" through `core.listProducts()` (still the `[]` stub — replaced in S2); storefront :3000 catalog renders empty; `/api/healthz` + `/api/readyz` green.

### Validation gate (S0)
```bash
pnpm install
pnpm --filter @hardware/db db:generate
pnpm --filter @hardware/db db:migrate:dev
pnpm --filter @hardware/db db:seed
pnpm --filter @hardware/db typecheck
pnpm build
pnpm dev   # manual: both apps boot, healthz/readyz green
```

### Acceptance (S0)
```txt
- Migration applies cleanly; every 13 model + enum exists in the DB; foundation models unchanged.
- pg_trgm extension + GIN indexes present (verify in db:studio or \d).
- Generated client typechecks; packages/db typecheck passes.
- Both apps boot; dashboard shows 0 products; healthz/readyz return ok. No product behaviour yet.
- StoreConfig "default" row exists. .env is gitignored; no secrets committed.
```

---

## Chunk 5 — Slice S1: Auth + RBAC + audit + shared service kernel

**Maps to:** `REMAINING-WORK.md` §1 (RBAC wiring, Auth, logger/correlation-id); `10` (full); `03` §5/§7 (kernel); `07` (sessions, hashing, rate-limit); ADR-0005.

The spine. No end-user feature, but every S2–S8 mutation consumes what lands here.

### Build
1. **Install Auth.js.** `pnpm add next-auth@beta @auth/prisma-adapter -w`; put `AUTH_SECRET` in each app's `.env`. Finish `packages/auth/src/nextauth/{staff,customer}.config.ts` — credentials providers, **two realms / two cookie scopes, never crossed** (10 §2.3); **DB-session strategy** (opaque cookie → `StaffSession`/`CustomerSession`), argon2id verify via existing `password.ts`.
2. **Auth flows.** Email-verify + password-reset using the existing `tokens.ts` + `VerificationToken` table (hashed tokens, both realms); customer register → verify → login; wire `ratelimit.ts` (Upstash sliding-window) + per-account lockout on login/register/reset route handlers (04 §6, 07).
3. **Session→permission resolution.** In `packages/core` add `resolveSession(staffUserId)` that loads `UserRole → Role → RolePermission → Permission.key` into the `Session.permissions` array the existing `rbac.ts` `can`/`requirePermission` consume. Cache per request. Provide an admin helper `getStaffSession()` / storefront `getCustomerSession()` in `packages/auth` that returns the typed `Session`.
4. **Audit writer.** Implement `audit(tx, { actorStaffId, roleAtTime, permissionUsed, action, targetType, targetId, before, after, requestId })` → `AuditLog` insert, **called inside the same `tx`** as the audited mutation (10 §7). Add a correlation-id (`requestId`) middleware/helper in both apps; wire `logger.redact` (already implemented + tested) into a server logger; Sentry init + `beforeSend` redaction.
5. **Shared transactional kernel** (the DB-touching stubs in `packages/core` become real):
   - `inventory.decrementStock(tx, productId, baseQty, kind, ref)` — the atomic `UPDATE "ProductStock" SET on_hand = on_hand - $q WHERE product_id = $id AND on_hand - reserved >= $q` guard (or `allowNegative` bypass) + signed `StockMovement` insert; throws `InsufficientStock` on 0 rows (03 §5).
   - `inventory.reserve` / `inventory.releaseExpired` — `Reservation` rows with `expiresAt`; `available = onHand − reserved` (03 §5).
   - `billing.nextInvoiceNo(tx, fy)` — `UPDATE "InvoiceCounter" SET last_no = last_no + 1 WHERE fy = $fy RETURNING last_no` (row-lock, gapless), formatted via the tested `formatInvoiceNo`; same pattern for `CreditNoteCounter` (03 §7).
6. **Seed: RBAC + owner.** Extend `seed.ts`: upsert all 33 `Permission` rows from `core.PERMISSIONS`; upsert `Role{OWNER}`; map OWNER→all permissions; create the first `StaffUser` (argon2id password from an env var) + `UserRole`. Permission keys are sourced from the `core` constant so code and DB never drift (10 §6).
7. **Guard the existing dashboard slice** end-to-end as the proof: `dashboard/page.tsx` resolves the staff session, `requirePermission(session, "products.read")`, and renders. Login page authenticates against the staff realm and sets the session cookie the middleware already checks.

### Dual guard wired this slice
- **Transport (Zod + session):** login/register/reset route handlers Zod-validate input and establish the realm session.
- **Core guard:** `requirePermission` now resolves real permissions (not a hand-built array); `audit()` available to all later slices.

### Validation gate (S1)
```bash
pnpm --filter @hardware/auth test     # argon2id + tokens (existing 5) stay green
pnpm --filter @hardware/core test      # kernel unit tests (decrementStock guard, nextInvoiceNo) added here
pnpm lint && pnpm typecheck && pnpm build
pnpm dev   # manual: login as seeded owner -> dashboard renders; bad creds rejected + rate-limited
```

### Acceptance (S1)
```txt
- Seeded owner can log in (DB session cookie set); logout clears it; customer realm cannot reach an admin route (middleware
  + realm check); 401 with no session, 403 when a permission is missing.
- resolveSession returns the OWNER's full permission set; requirePermission allows/denies correctly; never branches on role.
- decrementStock is atomic (concurrent-decrement unit/integration test: no oversell; throws InsufficientStock at the boundary).
- nextInvoiceNo is gapless under concurrency (a rolled-back tx burns no number; @@unique(fy, invoiceNo) holds).
- audit() writes inside the mutation tx; logger.redact masks PII/secrets; requestId correlates.
- Auth endpoints rate-limited + lockout on repeated failures. All prior tests still green.
```

---

## Chunk 6 — Slice S2: Catalog + UoM + Pricing

**Maps to:** `REMAINING-WORK.md` §2 (product CRUD, categories/brands/units, slabs, import); `04` Catalog/Units/Pricing/Import; `13` §4; `03` §4 (UoM) + §11 (search). **Permissions:** `products.*`, `units.manage`, `pricing.*`, `import.catalog`.

First end-user feature. Nothing stocks or sells until products exist.

### Build (full vertical)
- **Core `catalog/service.ts`** (replace the `listProducts → []` stub): `createProduct` (base unit + N sale units + `factorToBase` + per-unit MRP/sale price + HSN + GST rate + `priceInclusive`), `updateProduct`, `archiveProduct` (soft, `isActive=false` — no delete), `listProducts`/`getProduct` (cursor-paginated, `q` via pg_trgm, `category`/`brand`/`inStock` filters, storefront-safe field projection), `addSaleUnit`/`editSaleUnit`, category tree + brand + unit master CRUD. Reuse the tested `uom.toBaseQty` for any qty validation; reject fractional `PIECE`.
- **Core `pricing/service.ts`** (new): `resolvePrice(productId, saleUnitId, qty)` → walks `PriceSlab` by `minQty` desc, returns effective per-sale-unit price (bulk slabs visible to all — 02 Decision 5); `setPriceSlabs`/`editPriceSlab`.
- **CSV/Excel import** (`import/service.ts` + `POST /api/import/catalog` route, multipart): parse catalog + opening stock, validate per-row with the shared Zod schema, return `202` + `jobId`; process async via QStash (job arm stubbed until S7 wires the queue — synchronous fallback acceptable in S2, flagged). `GET /api/import/jobs/{id}` for row-level errors.
- **Transport:** server actions for create/update/archive/sale-units/slabs (form mutations, `Idempotency-Key` not required — not money-moving); route handlers for `GET /api/products`, `/products/{id}`, `/categories`, `/units`, `/products/{id}/price`. Every entry Zod-validates via the one schema in core; mutations `requirePermission` + `audit()`.
- **Admin UI** (`apps/admin/app/(admin)/catalog/*`): product list (search/filter/paginate), product create/edit form (the UoM editor is the hard part — base unit + add-sale-unit rows with factor + price + `allowDecimal`), category/brand/unit management, price-slab editor. Replace the dashboard's product count with a real list.
- **Storefront UI:** wire `apps/storefront/app/page.tsx` + product detail to the public `GET /api/products` (storefront-safe fields, sale-unit options, live stock placeholder until S3).

### UI success criteria (representative)
- **Create product:** owner opens Catalog → New, enters name/SKU/HSN/GST, picks base unit, adds sale units (e.g. metre factor 1, coil factor 90) each with price; saves → product appears in the list; a `PIECE` sale unit rejects a fractional default qty inline; duplicate SKU → `409`.
- **Bulk price:** add slabs (e.g. ≥10 → cheaper) on a sale unit; `GET .../price?qty=12&unitId=` returns the slab price.
- **Import:** upload a CSV of 50 products + opening stock → `202` + job; job report lists any bad rows; good rows appear in the catalog.
- **Failure modes:** missing required field → `400` inline; no `products.create` → action hidden + server `403` + audit; archive keeps the row (no delete) and hides it from storefront.

### Validation gate (S2)
```bash
pnpm --filter @hardware/core test     # catalog + pricing unit tests (UoM conversion, slab resolution)
pnpm lint && pnpm typecheck && pnpm build
pnpm dev   # manual: create product with 2 sale units; search; slab price; CSV import
```

### Acceptance (S2)
```txt
- Product CRUD with base + N sale units + factors persists; toBaseQty drives every qty; PIECE rejects fractions.
- Slabs resolve correctly for (product, saleUnit, qty); visible to storefront and counter.
- Search returns pg_trgm matches across pages (cursor pagination, stable under inserts).
- CSV import creates products + opening stock; row errors reported; archive is soft (isActive=false).
- Every mutation Zod-validated + permission-guarded + audited. Storefront shows the catalog. Prior tests green.
```

---

## Chunk 7 — Slice S3: Inventory / Stock

**Maps to:** `REMAINING-WORK.md` §2 (GRN, adjustments, returns, batches, low-stock, reports); `04` Stock/Suppliers; `13` §5–§6; `03` §5. **Permissions:** `stock.*`, `suppliers.*`.

Stock must exist before anything sells it; first heavy use of the decrement kernel (here mostly `+`/signed).

### Build (full vertical)
- **Core `inventory/service.ts`** (extend the S1 kernel): `recordGrn` (supplier + lines → `GoodsReceipt`/`GrnLine`, increments `ProductStock.onHand` via `GRN_IN` movements, optional `Batch` with expiry, cost per base unit; converts receive-unit qty → base via `toBaseQty`), `adjustStock` (signed `ADJUST_IN`/`ADJUST_OUT` + required reason; opening stock), `recordReturn` (`SALES_RETURN_IN`/`PURCHASE_RETURN_OUT`), `listMovements` (the ledger; kacha shows as `KACHA_OUT`), `nearExpiry`, `lowStock` (onHand ≤ `reorderLevel`). Maintain `Batch.onHand` in parallel with `ProductStock.onHand` (reconciliation job noted for S7).
- **Core `suppliers`**: CRUD + optional `SupplierPayment` dues ([N]).
- **Transport:** `POST /api/grn` (both — server action in-UI + route for programmatic; `Idempotency-Key` since stock-moving), `POST /api/stock/adjustments` (action), `POST /api/stock/returns` (action), `GET /api/stock`/`/stock/movements`/`/stock/near-expiry` (routes), supplier CRUD. All Zod + `requirePermission` + `audit()`.
- **Admin UI** (`apps/admin/app/(admin)/stock/*`): GRN entry form (supplier + lines + batch/expiry), stock list with low-stock flag, movement ledger, adjustments (with reason), returns, supplier directory, near-expiry list. Wire storefront "live stock" on the product page to `ProductStock.available`.

### UI success criteria (representative)
- **GRN:** receive 5 coils of wire → 450 base metres added (factor 90); `ProductStock.onHand` reflects it; a `GRN_IN` movement + batch row exist; idempotent on retry (same key → same result, no double-add).
- **Adjustment:** mark −2 (damage) with reason → `ADJUST_OUT` movement, onHand drops, audit row written; negative-stock blocked unless `allowNegative` (returns/adjustments policy per 03 §5).
- **Low-stock / near-expiry:** an item below reorder level appears flagged; a batch within the window appears in near-expiry.
- **Failure modes:** GRN with bad product/unit → `400`; oversell adjustment on a block-negative product → `409 STOCK_INSUFFICIENT`; no `stock.grn` → `403` + audit.

### Validation gate (S3)
```bash
pnpm --filter @hardware/core test     # GRN conversion, signed movements, low-stock/near-expiry, negative-stock policy
pnpm lint && pnpm typecheck && pnpm build
pnpm dev   # manual: GRN -> stock up; adjust -> movement+audit; storefront live stock
```

### Acceptance (S3)
```txt
- GRN converts receive-unit -> base and increments stock atomically; batches/expiry recorded; idempotent.
- Adjustments/returns write signed movements + reason + audit; negative-stock policy enforced (block default, allow-flag opt-in).
- Movement ledger shows all kinds incl. KACHA_OUT placeholder; low-stock + near-expiry surfaces correct items.
- Storefront product page shows live available stock. Suppliers CRUD works. Prior tests green.
```

---

## Chunk 8 — Slice S4: Counter Billing (Kacha + Pakka) — the daily core

**Maps to:** `REMAINING-WORK.md` §4 (POS, kacha, pakka, payment modes, print); `04` Billing-Kacha/Pakka; `13` §8; `03` §6 (kacha), §7 (numbering), §8 (tax). **Permissions:** `bill.kacha.create`, `bill.pakka.create`, `bill.read`.

The shop's daily core. Reuses S1's `decrementStock` + `nextInvoiceNo` and the tested `computeLineTax`/`backCalcTaxable`/`money`.

### Build (full vertical)
- **Core `billing/service.ts`** (replace the `BILLING_PATTERNS` stub):
  - `finalizeKacha(lines)` — **one `prisma.$transaction`, writes ONLY `KACHA_OUT` movements** via `decrementStock`; converts each line qty → base via `toBaseQty`; returns an ephemeral estimate payload (no invoice no, no persisted bill, no ledger/tax/customer — 03 §6, 13 §8). Audited as an unattributed stock-out (actor + movement only, 10 §7).
  - `finalizePakka(lines, customer, payment, placeOfSupply)` — one transaction: `nextInvoiceNo(fy)` (gapless), per-line `computeLineTax` (CGST/SGST vs IGST by place-of-supply; discount-before-tax; MRP-inclusive back-calc), per-invoice round-off to rupee (`money`), `decrementStock` per line (`SALE_OUT`), insert `Invoice` + `InvoiceLine` + `Payment`(s); if khata/part-payment, post the balance to the ledger (delegates to S5's `ledger.post`, available by S5 — in S4 cash/UPI/card only, khata flagged TODO until S5). Manual rate override per line honoured. Idempotent on `Idempotency-Key`.
  - `convertKachaToPakka` — submits the in-memory kacha cart to `finalizePakka`; if stock was already decremented via a prior kacha estimate, attributes the existing movement instead of double-deducting (04 §8.4). Never an "upgrade" of a committed kacha.
  - `listInvoices`/`getInvoice` for reprint.
- **Transport:** `POST /api/billing/kacha/decrement` (action — ephemeral, NOT idempotent in the bill sense), `POST /api/billing/kacha/convert` (both, idempotent), `POST /api/billing/pakka` (both, idempotent), `GET /api/billing/pakka`/`{id}` (routes). Zod + `requirePermission` + `audit()`; idempotency table `(key, principal, route, hash) → response` (04 §5).
- **Admin POS UI** (`apps/admin/app/(admin)/billing/*`): fast add-by-search/barcode, pick sale unit + qty, line/bill discount, manual rate override, round-off, live total; toggle **Kacha** (no tax shown) vs **Pakka** (GST breakup); one-click convert; payment panel (cash + change / UPI / card / khata + part-payment); GSTIN capture for pakka.
- **Print templates:** thermal 2"/3" + A4/A5 (selectable), pulling shop logo/name/address/GSTIN + bank details + T&C/signature from `StoreConfig` (no UPI QR per 02). PDF to R2 or on-demand render (A3 in `02` — decide here; default on-demand to skip R2 dependency in S4).

### UI success criteria (representative)
- **Kacha:** add items, finalize → stock drops (`KACHA_OUT` only), a rough estimate prints, **no invoice number, no DB bill** (verify `Invoice` table unchanged); cash drawer not reconciled (accepted).
- **Convert → pakka:** same cart, one click → a saved `Invoice` with a gapless number, full GST, prints; the kacha never persisted.
- **Pakka intra-state:** CGST+SGST split; **inter-state** → IGST; manual override on a line changes its taxable value; round-off line appears; khata payment posts the balance to the customer ledger (S5).
- **Failure modes:** oversell → `409 STOCK_INSUFFICIENT`; duplicate submit (same key) → original invoice replayed, no second number burned; no `bill.pakka.create` → `403` + audit; cancel/credit-note attempted here → routed to S5.

### Validation gate (S4)
```bash
pnpm --filter @hardware/core test     # tax split, round-off, kacha-writes-only-movement, gapless under concurrency, override
pnpm lint && pnpm typecheck && pnpm build
pnpm dev   # manual: kacha (zero-trace), convert, pakka intra/inter-state, part-payment, reprint
```

### Acceptance (S4)
```txt
- finalizeKacha persists exactly one KACHA_OUT movement per line and nothing else (asserted against Invoice/Payment/Ledger).
- finalizePakka: gapless number in the same tx (rollback burns none); CGST/SGST vs IGST correct by place-of-supply;
  discount-before-tax; per-invoice round-off; stock decremented; idempotent on retry.
- Convert path creates a real pakka, never double-decrements, never an upgrade of committed kacha.
- Print templates (thermal + A4/A5) render with StoreConfig branding. Every op permission-guarded + audited. Prior tests green.
```

---

## Chunk 9 — Slice S5: Khata ledger + Returns / Credit Notes + Cancel

**Maps to:** `REMAINING-WORK.md` §4 (khata, returns/credit notes, cancel/amend); `04` Khata/Ledger + Billing cancel/credit-note; `13` §7–§8; `03` §7. **Permissions:** `ledger.*`, `customers.*`, `bill.cancel`, `bill.creditnote.create`.

Closes the financial-correction loop S4 opened.

### Build (full vertical)
- **Core `ledger/service.ts`** (new): `post(tx, customerId, type, amount, ref)` (called by `finalizePakka` for khata/part-payment balances), `recordPayment` (part-payment receipt, idempotent), `getStatement`/`outstanding`/`aging` (0-30/31-60/60+ buckets), `triggerReminder` (queues via QStash in S7). Counter-customer CRUD (`customers.*`) — `Customer` party distinct from storefront `CustomerAccount`.
- **Core billing extensions:** `cancelInvoice` (status→`CANCELLED`, reason required, reverses stock + ledger, audit/void log — no delete, gapless preserved), `createCreditNote` (own gapless `CreditNoteCounter` series; references the original invoice; partial returns; refund mode cash/UPI/khata-adjust/gateway; reverses stock via `SALES_RETURN_IN`).
- **Transport:** `GET /api/customers`/`POST` (counter customers), `GET /api/ledger/{id}` + `POST .../payments` (idempotent) + `POST .../reminders`, `POST /api/billing/pakka/{id}/cancel` (action), `POST .../credit-note` (both, idempotent). Zod + guard + audit.
- **Admin UI** (`apps/admin/app/(admin)/ledger/*` + billing actions): khata directory + statement + aging view + record-payment, dues reminder button; on an invoice: cancel (reason) + create-credit-note (pick lines, refund mode). Now finalize the khata branch of S4's `finalizePakka` (post balance + show change).

### UI success criteria (representative)
- **Khata:** a part-paid pakka posts the balance to the customer's ledger; the statement shows it; aging buckets it; recording a later payment reduces outstanding (idempotent).
- **Credit note:** issue a partial CN against a pakka → own gapless CN number, stock returns (`SALES_RETURN_IN`), ledger credited; original invoice stays `ACTIVE` (gapless intact).
- **Cancel:** cancel a pakka with reason → status `CANCELLED`, stock + ledger reversed, void log written; the number is **not** reused.
- **Failure modes:** cancel an already-cancelled invoice → `422`; credit-note more than billed → `400`; no `bill.cancel` (owner-only) → `403` + audit.

### Validation gate (S5)
```bash
pnpm --filter @hardware/core test     # ledger post/aging, CN gapless series, cancel reversal, refund modes
pnpm lint && pnpm typecheck && pnpm build
pnpm dev   # manual: part-pay khata -> aging -> settle; credit note; cancel
```

### Acceptance (S5)
```txt
- Khata receivables posted by pakka/khata sales; aging buckets correct; payments idempotent and reduce outstanding.
- Credit notes use an independent gapless series, reverse stock+ledger, reference the invoice, support partial + refund modes.
- Cancel reverses stock+ledger, sets CANCELLED (never deletes), writes the void log; numbers never reused.
- S4's khata payment branch now posts to the ledger. Owner-only cancel enforced. All guarded + audited. Prior tests green.
```

---

## Chunk 10 — Slice S6: Ecommerce / Orders

**Maps to:** `REMAINING-WORK.md` §3 (storefront, accounts, order flow, delivery, payments, notifications); `04` Orders + Payments/Razorpay; `13` §9; `03` §5 (reservations), §9 (Razorpay). **Permissions:** customer `orders.place`/`orders.cancel.own`/`ledger.read.own`; staff `orders.read`/`orders.fulfil`.

Grafts onto the proven counter machinery: dispatch delegates to S4's `finalizePakka`; online returns reuse S5.

### Build (full vertical)
- **Core `orders/service.ts`** (new): `placeOrder` (one tx: `reserve` stock with TTL, insert `Order`(PENDING_PAYMENT|PAY_LATER)+`OrderLine`, compute item total + delivery fee/free-threshold from `StoreConfig`, place-of-supply from delivery address; idempotent; `409 STOCK_INSUFFICIENT` on reserve fail), `markPaid(orderId, paymentId, eventId)` (idempotent on `ProcessedWebhook.eventId` via `INSERT … ON CONFLICT DO NOTHING`, same tx as state change — 03 §9), `accept`/`pack`/`dispatch`/`complete`/`cancel`. **`dispatch`** converts the reservation → final `decrementStock` (`ORDER_DISPATCH_OUT`) **and generates the pakka invoice via S4 `finalizePakka`** in one tx (pakka-on-dispatch; IGST if inter-state).
- **Razorpay:** `POST /api/payments/razorpay/order` (create gateway order, return id + key), `POST /api/webhooks/razorpay` (route, **public-by-signature**): read raw body, verify HMAC-SHA256, dedupe on `event.id`, `markPaid`; always `200` once handled. Card data never touches us (hosted checkout).
- **Customer accounts:** register→verify→login (S1 flows), profile, addresses, **order history**, reorder; cart (`GET/POST/DELETE /api/cart*`).
- **Transport:** storefront customer-session route handlers + actions (`/orders`, `/cart`); admin staff fulfilment routes (`/api/admin/orders/*`). Zod + guard (+ **ownership checks** for `.own`) + audit; idempotency on place/payment.
- **Notifications:** order-status email via Resend (queued in S7); SMS via MSG91 where DLT approved.
- **Storefront UI:** category browse/search/filter, product page (unit options + live stock), cart, checkout (address/GSTIN/delivery-or-pickup/payment), order tracking. **Admin UI:** order queue + accept→pack→dispatch→complete screen.

### UI success criteria (representative)
- **Place order:** customer checks out → stock **reserved** (TTL), order `PENDING_PAYMENT`; available stock drops at the counter too (shared pool); reorder from history works.
- **Pay online:** hosted Razorpay checkout → signed webhook → order marked paid (idempotent: re-delivered webhook is a no-op); pay-later orders stand as `PAY_LATER` but still reserve.
- **Dispatch:** owner accept→pack→dispatch → reservation converts to final decrement **and a pakka invoice is generated** (IGST if delivering inter-state); customer gets the invoice + dispatch email.
- **Failure modes:** insufficient stock at placement → `409`; abandoned cart auto-releases after TTL (S7 job); cancel-before-dispatch releases the reservation; bad webhook signature → `400` + alert; a customer fetching someone else's order → `404`/`403`.

### Validation gate (S6)
```bash
pnpm --filter @hardware/core test     # reserve/release, place-order totals, markPaid idempotency, dispatch->invoice
pnpm lint && pnpm typecheck && pnpm build
pnpm dev   # manual: browse->cart->checkout->(Razorpay test)->webhook->dispatch->invoice
```

### Acceptance (S6)
```txt
- placeOrder reserves atomically with TTL; no oversell across counter+online; idempotent; delivery fee/threshold applied.
- Razorpay webhook verifies signature + dedupes on event.id; order paid in the same tx; redelivery is a safe no-op.
- Dispatch converts reservation -> final decrement AND generates the pakka invoice (place-of-supply correct); never double-counts.
- Customer accounts: register/verify/login/profile/addresses/history/reorder; ownership-scoped reads enforced.
- Notifications queued. Prior tests green.
```

---

## Chunk 11 — Slice S7: Reports + Dashboard + Jobs + Settings + Backups

**Maps to:** `REMAINING-WORK.md` §4 (GSTR-1, day-end/reports) + §5 (audit viewer, dashboard, jobs, backups, security, StoreConfig); `04` Reports/Import; `03` §10 (jobs), §11 (search); `13` reports section. **Permissions:** `reports.*`, `settings.*`, `audit.read`.

Aggregates over everything S2–S6 produced; turns on the scheduled spine.

### Build (full vertical)
- **Core `reports/service.ts`** (read-only, no mutations): `salesReport` (day/item/category/payment-mode), `dayEnd` (pakka only — **kacha excluded by design**, no rows exist), `gstr1` (B2B/B2C/credit-notes + HSN summary, JSON + CSV) computed as queries/views over `Invoice`+`InvoiceLine`(+`CreditNote`) — not new tables (13 reports note), `stockValuation`.
- **Background jobs** (Vercel Cron → QStash → authenticated route handlers calling core; all idempotent — 03 §10): reservation-expiry (`inventory.releaseExpired`), khata reminders (recompute aging + send), day-end roll-up, near-expiry/low-stock alerts, `Batch.onHand`↔`ProductStock.onHand` reconciliation, encrypted `pg_dump` → R2 (6-year retention). Wire the S2 CSV import + S6 notifications onto the same QStash arm.
- **StoreConfig admin screen** (`settings.*`): shop name, GSTIN, home state, logo (R2), bank details, T&C, delivery fee/threshold, reservation TTL, GST rounding mode, invoice prefix.
- **Dashboard:** today's sales, low stock, dues, top items (reads across modules).
- **Audit viewer** (`audit.read`): append-only log browser.
- **Security finishing:** finalize headers/CSP, least-privilege DB role, secret management; R2 signed URLs for images/PDFs.

### UI success criteria (representative)
- **GSTR-1:** export `?period=2026-06` → B2B/B2C/CN sections + HSN summary; CSV downloads; figures reconcile to the invoices; kacha absent.
- **Jobs:** an expired reservation is released within the cron window (available stock returns); an overdue khata triggers a reminder email; day-end summary populates the dashboard.
- **Settings:** owner edits GSTIN/home-state/delivery fee → reflected in new invoices/orders; logo appears on prints.
- **Failure modes:** unauthenticated cron callback → rejected (shared secret/signature); report with no data → empty (never fabricated); a job failure is retried by QStash (idempotent, no double-effect).

### Validation gate (S7)
```bash
pnpm --filter @hardware/core test     # gstr1/day-end aggregation, aging recompute, reservation-expiry idempotency
pnpm lint && pnpm typecheck && pnpm build
pnpm dev   # manual: run a job endpoint; export GSTR-1; edit settings; view audit log
```

### Acceptance (S7)
```txt
- GSTR-1 (B2B/B2C/CN + HSN) + sales/day-end/valuation reports correct; kacha excluded; CSV export works.
- All cron/QStash jobs idempotent + authenticated; reservation-expiry, reminders, day-end, near-expiry/low-stock, backup run.
- StoreConfig admin screen drives invoices/orders/prints; dashboard surfaces sales/low-stock/dues/top-items; audit viewer read-only.
- Encrypted pg_dump -> R2 with retention; CSP/headers/secret-management finalized. Prior tests green.
```

---

## Chunk 12 — Slice S8: Quality, CI/CD & go-live

**Maps to:** `REMAINING-WORK.md` §6 (tests, CI/CD, seed, Dockerfiles) + §7 (go-live) + §8 (open decisions); `11` Phases 10–11; ADR-0010 (hosting). **No production flag until this is green.**

### Build
- **Tests:** integration tests on a **Dockerised Postgres** for the two correctness-critical invariants — `decrementStock` (no oversell under concurrency) and **gapless numbering** (no gaps/collisions under concurrent finalize); Playwright **e2e** for the key slices (create product → GRN → kacha → convert→pakka → khata → place order → dispatch→invoice → GSTR-1); expand unit coverage. Wire the already-declared `test`/`test:e2e` turbo tasks.
- **CI/CD (GitHub Actions):** lint → typecheck → test → build + integration/e2e on a Postgres service container; **Dependabot + `pnpm audit` + gitleaks**; preview deploy per PR (Vercel + Neon branch); `prisma migrate deploy` on main.
- **Seed (full):** owner + RBAC + sample UoM catalog/stock for demos/UAT (extends S1's seed).
- **Dockerfiles** per app + `docker-compose` (VPS option, ADR-0010 Option A).
- **Go-live:** pick hosting (Vercel Pro **or** Mumbai VPS); domain + DNS + TLS; production env/secrets + **Razorpay live keys** + webhook secret; fill real `StoreConfig` (GSTIN/logo/bank/terms/home-state); **UAT with the owner** + staff handover; backup schedule live; **runbook** (incident, secret rotation, restore drill).
- **Settle the open decisions (`REMAINING-WORK.md` §8 / the docs' TBDs):** reservation TTL value, decimal scale for qty, per-line vs per-invoice GST rounding (with the accountant), credit-note series format, negative-stock defaults, admin/storefront domains.

### Validation gate (S8)
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
# CI runs the same + integration (Dockerised PG) + audit/gitleaks on every PR; migrate deploy on main.
```

### Acceptance (S8 — go-live gate)
```txt
- Integration tests green: decrementStock no-oversell + gapless numbering no-gap/collision under concurrency.
- Playwright e2e green for every key slice (happy + denial/permission paths).
- CI green on a clean checkout: lint+typecheck+test+build+integration+e2e; Dependabot/audit/gitleaks clean; preview deploys work.
- Full seed runs; Dockerfiles build; docker-compose stands the stack up.
- Hosting + domain + TLS live; Razorpay LIVE webhook verified end-to-end; real StoreConfig filled.
- UAT signed off by the owner; backups scheduled + a restore drill done; runbook written. All §8 TBDs decided + recorded.
- HARD RULE: no green CI + no UAT sign-off => no go-live.
```

---

## Chunk 13 — Traceability + targets

### Module → slice
| Module (02 §3) | Slice | Core service | Key invariant |
|---|---|---|---|
| Foundation (DB/auth/RBAC/audit/kernel) | S0–S1 | `inventory.decrementStock`, `billing.nextInvoiceNo`, `audit`, `resolveSession` | atomic stock; gapless numbers; server-enforced authz |
| Catalog + Pricing | S2 | `catalog/*`, `pricing/*` | one base unit + N sale units; slabs visible to all |
| Inventory / Stock | S3 | `inventory/*`, `suppliers` | only Inventory mutates stock; signed movements |
| Billing (kacha/pakka) | S4 | `billing/*` | kacha = one KACHA_OUT only; only Billing mints numbers/tax |
| Ledger + CN + cancel | S5 | `ledger/*`, billing cancel/CN | no deletes; own gapless CN series |
| Orders / Ecommerce | S6 | `orders/*` | reserve-on-place; pakka-on-dispatch; webhook idempotent |
| Reports / Jobs / Settings | S7 | `reports/*`, jobs | reports read-only; kacha excluded; jobs idempotent |
| Quality / CI / go-live | S8 | — | green CI + UAT before go-live |

### `REMAINING-WORK.md` → slice
§0 + §1 → **S0–S1** · §2 → **S2–S3** · §3 → **S6** · §4 → **S4–S5** (+ GSTR-1 in **S7**) · §5 → **S7** · §6 → **S8** · §7 → **S8** · §8 (open decisions) → settled in **S8**.

### Targets (non-functional)
```txt
- Money/qty: Prisma Decimal in DB, integer paise on the wire, superjson for Decimal across server actions. No floats. (13, 04 §2)
- Correctness: decrementStock atomic + race-safe; invoice + CN numbering gapless under concurrency (proven by S8 integration tests).
- Authz: every mutation Zod-validated at transport + requirePermission in core + audit() on sensitive ops, in one tx.
- Idempotency: pakka/convert/place-order/payment/CN carry Idempotency-Key; Razorpay webhook dedupes on event.id.
- Search: pg_trgm typeahead fine to ~5k SKUs; cursor pagination on every list.
- Cost/hosting: free during dev (Vercel Hobby + Neon free); paid tier (Vercel Pro ~Rs 2,100/mo or Mumbai VPS ~Rs 450/mo) at go-live (ADR-0010).
```

---

## Chunk 14 — Validation (consolidated)

Run after each slice and before any go-live:
```bash
pnpm install
pnpm --filter @hardware/db db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# from S6+: pnpm test:e2e ; in CI: integration tests on Dockerised Postgres + pnpm audit + gitleaks
```

Test tiers (this is the v1 testing strategy):
```txt
- unit (Vitest, packages/core + auth): UoM conversion, tax split/round-off, slab resolution, gapless numbering,
  kacha-writes-only-movement, ledger aging, reserve/release, markPaid idempotency, argon2id/tokens.
- integration (Dockerised Postgres): decrementStock concurrency (no oversell), gapless numbering concurrency (no gap/collision),
  webhook idempotency, dispatch->invoice atomicity.
- e2e (Playwright): the key slices end-to-end (catalog->GRN->kacha->convert->pakka->khata->order->dispatch->GSTR-1) + denial paths.
- static: lint (incl. import-boundary rules from packages/config), typecheck, pnpm audit, gitleaks.
```

Global go-live gate: every slice's acceptance met · CI green on a clean checkout · e2e + integration green · UAT signed off · backups + runbook live.

---

## Chunk 15 — Agent handoff prompt

```txt
Build the Hardware Store v1 on top of the scaffold, following docs/architecture/14-implementation-plan.md exactly.
Stack: Next.js App Router modular monolith, Turborepo + pnpm, Prisma + PostgreSQL (Neon), Auth.js v5. There are NO
Durable Objects / service mesh / realtime / read-model projections — the authoritative mutation is a prisma.$transaction
inside packages/core; the guard is Zod (transport) + requirePermission (core) + audit() in the same tx.

Order: S0 (run + grow schema to docs/architecture/13 + seed skeleton) -> S1 (Auth.js + RBAC resolve + audit + the shared
kernel: decrementStock/reserve/release/nextInvoiceNo + owner/RBAC seed) -> S2 (Catalog+UoM+Pricing) -> S3 (Inventory/Stock)
-> S4 (Billing kacha/pakka) -> S5 (Ledger+CN+cancel) -> S6 (Orders+Razorpay) -> S7 (Reports+Jobs+Settings+Backups)
-> S8 (tests+CI/CD+go-live). One slice at a time; each is a full vertical: Zod transport -> requirePermission -> core
service (one $transaction) -> audit() -> typed DTO -> UI.

Owners (find the existing file before adding anything):
- Schema: packages/db/prisma/schema.prisma (grow to docs/architecture/13; foundation models stay verbatim).
- Permissions: packages/core/src/shared/rbac.ts PERMISSIONS (33 keys) — seed from this constant; never branch on role.
- Pure primitives already done + tested: shared/{uom,tax,money,rbac,logger}.ts, billing/numbering.ts — REUSE, don't re-derive.
- Core services to implement: catalog/pricing/inventory/billing/ledger/orders/reports/import + audit() + resolveSession.
- Auth: packages/auth (password/tokens/ratelimit done; install next-auth@beta + @auth/prisma-adapter; finish nextauth/*.config.ts).
- Transport: apps/admin + apps/storefront server actions (form mutations) + route handlers (GET/webhook/cron/import).

Do NOT: import packages/db from an app; import Prisma outside packages/core; put React in core; open a tx in transport;
branch on role name; persist anything for kacha except one KACHA_OUT movement; hard-delete a financial record; mint an
invoice number outside the counter UPDATE...RETURNING in the invoice tx; use float for money/qty; trust the client for
authz; mark an order paid from the browser (use the signed webhook, idempotent on event.id); skip audit() on sensitive ops.
Do NOT build e-Invoice/IRN, e-Way bill, wholesale price lists, RFQ/quotation/challan, variants, multi-store, WhatsApp,
2FA, or Cashier/Stock-Manager/Accountant roles in v1 (Chunk 3 out-of-scope).

After each slice run: pnpm lint && pnpm typecheck && pnpm test && pnpm build (from S6: + pnpm test:e2e). At S8 add the
Dockerised-Postgres integration tests (decrementStock + gapless numbering) and GitHub Actions. HARD RULE: no green CI +
no UAT sign-off => no go-live. Commit or push only when explicitly asked.
```
