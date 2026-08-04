# P0 — Multi-tenant migration (detailed slice-plan & build-spec)

**Status:** Executing. This is the make-or-break foundation from [16-saas-platform-base.md](16-saas-platform-base.md) §8 P0.
**Goal:** turn the single-shop app into a multi-tenant SaaS where **every business row carries `shopId`** and **every query is scoped to the caller's shop** — without breaking the working app.

This doc is also the **frozen contract** the implementation agents follow. Conventions in §4 are binding.

---

## 1. Locked decisions (engineering, in service of "simple + safe")

1. **Isolation = shared DB + row-level `shopId`** (confirmed in doc 16). No schema-per-tenant.
2. **`shopId` is a bare indexed scalar** on every business table — `shopId String` + `@@index([shopId])`, **no Prisma relation and no DB-level FK**. Reasons: (a) a relation would need 30 fields + 30 back-relations on `Shop`; (b) a hand-added SQL FK that isn't in the Prisma schema reads as *drift* and Prisma Migrate would try to drop it on the next `migrate dev`. Keeping `shopId` a plain indexed column means the schema is the single source of truth (no drift), and tenant integrity is guaranteed by trusted server code — `shopId` is only ever set from a validated session/ctx, and `Shop` rows are never hard-deleted while data exists (guarded in the P1 admin flow).
3. **Explicit `shopId` threading, not a Prisma `$extends` scoped client.** Reason: `$extends` query-overrides do **not** apply to the `tx` client inside interactive transactions (our money/stock paths) and cannot cover the ~10 `$queryRaw`/`$executeRaw` sites. Explicit `shopId` in every `where`/`data` is greppable, testable, and composes with `runTx`.
4. **One staff user belongs to one shop** → `StaffUser.shopId`. `ShopMembership` / `Plan` / `Subscription` are **deferred** to when owner-invites-staff and billing actually land (P2/P4); a direct FK is the simplest thing that is correct today. Roles/permissions stay global for now (a shop's OWNER/CASHIER definitions are shared) — per-shop roles are a later, additive change.
5. **Platform super-admin (P1) is a separate realm**, not a `StaffUser` — so `StaffUser.shopId` can be required. No nullable-shop footgun on the session.
6. **`shopId` never enters the session cookie.** The cookie is an opaque `StaffSession` id; the `Session` is rebuilt from the DB each request. `shopId` is added in `resolveSession` only.
7. **Expand → migrate → contract** sequencing (§5). The expand migration is purely additive + backfill, so the app keeps working as a single shop with zero code change; scoping lands incrementally; a final contract migration tightens constraints.

---

## 2. Schema changes

### 2a. New model
```prisma
model Shop {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique          // tenant routing key (subdomain/path, later)
  status    String   @default("ACTIVE") // ACTIVE | SUSPENDED
  plan      String   @default("FREE")   // placeholder until Plan/Subscription (P4)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 2b. `shopId` scalar + index on every business table
Add `shopId String` (nullable in expand, `NOT NULL` in contract) and `@@index([shopId])` to **all** of:
Category, Brand, Unit, Product, ProductSaleUnit, ProductStock, StockMovement, PriceSlab, Batch, Reservation, Supplier, GoodsReceipt, GrnLine, SupplierPayment, Customer, Address, LedgerEntry, Invoice, InvoiceLine, Payment, CreditNote, CreditNoteLine, Order, OrderLine, StoreConfig, InvoiceCounter, CreditNoteCounter, AuditLog, IdempotencyKey, ProcessedWebhook.

Plus `StaffUser.shopId` (the tenant a staff user belongs to).

**Why child/line tables too (denormalized):** uniform rule "every business row has `shopId`" is leak-proof and greppable, and lets the flagged `groupBy` aggregates (`invoiceLine.groupBy`, `ledgerEntry.groupBy`, `batch.groupBy`) filter by `shopId` directly instead of via fragile joins.

### 2c. Constraint changes (applied in the **contract** migration)
| Table | Today | Becomes |
|---|---|---|
| Brand | `name @unique` | `@@unique([shopId, name])` |
| Unit | `code @unique` | `@@unique([shopId, code])` |
| Product | `sku @unique` | `@@unique([shopId, sku])` |
| Invoice | `@@unique([fy, invoiceNo])` | `@@unique([shopId, fy, invoiceNo])` |
| CreditNote | `@@unique([fy, creditNoteNo])` | `@@unique([shopId, fy, creditNoteNo])` |
| Order | `orderNo @unique` | `@@unique([shopId, orderNo])` |
| InvoiceCounter | `@id(fy)` | `@@id([shopId, fy])` |
| CreditNoteCounter | `@id(fy)` | `@@id([shopId, fy])` |
| StoreConfig | `id @default("default")` | `shopId String @id` (one row per shop; drop the `"default"` sentinel) |

**Stay as-is** (parent FK already implies the shop): `ProductSaleUnit @@unique([productId, unitId])`, `Batch @@unique([productId, code])`, `IdempotencyKey @@unique([key, principalId, route])`, `Invoice.orderId @unique`, `ProductStock.productId @id`.
**Stay global:** `StaffUser.email`, `Role.key`, `Permission.key`, `VerificationToken.tokenHash`, `ProcessedWebhook.eventId` (gateway-unique; gets a `shopId` column only).
**Later decision (not P0):** `CustomerAccount.email` → likely `@@unique([shopId, email])` when per-shop storefronts go live.

---

## 3. Session / context wiring

- `packages/core/src/shared/rbac.ts` — add `shopId?: string` to `Session` (optional in type so the customer/platform realms compile; **required in practice for STAFF**).
- `packages/core/src/shared/session.ts` — `resolveSession` selects `StaffUser.shopId` and returns it on the Session; return `null` if a STAFF user has no shop. `resolveCustomerSession` selects `Customer.shopId` similarly.
- **No change** to the cookie, `@hardware/auth`, middleware, login action, or the 65 transport call-sites — they pass the whole `Session` through and inherit `shopId` for free.
- **Helper:** add `requireShop(session): string` in `rbac.ts` — returns `session.shopId` or throws `Forbidden("shop-scope")`. Every service that touches tenant data calls it once at the top.

---

## 4. Scoping conventions (BINDING for implementation agents)

Source of `shopId` in a service = `requireShop(ctx.session)`. Then:

- **Reads (`findMany`/`aggregate`/`groupBy`/`count`):** add `shopId` to `where`. For `groupBy` with no `where` today, add `where: { shopId }`.
- **Creates (`create`/`createMany`):** add `shopId` to `data` (every element for `createMany`). **Nested creates:** the parent's `shopId` does NOT propagate — set `shopId` on each nested row too (e.g. `Invoice.lines.create[]`, `Product.saleUnits.create[]` + `stock.create`).
- **By-id reads (`findUnique({where:{id}})`):** → `findFirst({ where: { id, shopId } })`. (A global cuid won't collide across shops, but a *guessed* foreign id would leak without this.)
- **By-id writes (`update`/`delete({where:{id}})`):**
  - If the service **already loaded** the row scoped (`findFirst({id, shopId})`) earlier in the same tx → the subsequent `update({where:{id}})` is safe as-is (ownership proven).
  - If it's a standalone by-id write with no prior scoped load → use `updateMany`/`deleteMany({ where: { id, shopId } })` and assert the affected count is 1.
- **Raw SQL (`$queryRaw`/`$executeRaw`):** add `AND "shopId" = ${shopId}` to the predicate and set `shopId` in any raw INSERT.

### 4a. Kernel signatures (FROZEN — buckets code against these)
```
audit(tx, input)                         // input gains: shopId: string
decrementStock(tx, shopId, productId, ...) 
incrementStock(tx, shopId, ...)
reserve(tx, shopId, ...)
releaseExpired(tx, shopId | null, now)   // null = all shops (system job)
nextInvoiceNo(tx, shopId, fy)
nextCreditNoteNo(tx, shopId, fy)
buildOrderInvoiceTx(tx, input)           // input gains: shopId
ledger.post(tx, shopId, customerId, type, amount, ref)
getStoreConfig(shopId) / getFullStoreConfig(shopId) / updateStoreConfig(input, ctx)  // by shopId
```
Report/dashboard/job read functions that take no session today gain an explicit `shopId` parameter.

### 4b. The gapless numbering row-lock (correctness-critical)
`nextInvoiceNo` / `nextCreditNoteNo` in `billing/service.ts`:
- `upsert({ where: { fy } })` → `upsert({ where: { shopId_fy: { shopId, fy } }, create: { shopId, fy, lastNo: 0 } })`.
- Raw `UPDATE "InvoiceCounter" SET "lastNo"="lastNo"+1 WHERE "fy"=${fy} RETURNING "lastNo"` → add `AND "shopId"=${shopId}`.
- Per-shop counter row = per-shop lock (shops no longer serialize against each other — a bonus).

---

## 5. Migration sequencing (expand → contract)

**Migration 1 — EXPAND (additive, zero code change, app keeps working):**
1. `CREATE TABLE "Shop"`.
2. `ALTER TABLE … ADD COLUMN "shopId" TEXT` (nullable) on every business table + `StaffUser`; `CREATE INDEX` on each.
3. `INSERT INTO "Shop"` a single **Shop #1** (id `shop_0001`, name from existing `StoreConfig.name`, slug `shop-1`).
4. Backfill: `UPDATE <each table> SET "shopId"='shop_0001'` and `UPDATE "StaffUser" SET "shopId"='shop_0001'`.
   *(No DB-level FK — see §1.2. Counters + StoreConfig keep their current PK/`"default"` key here — only a `shopId` column is added — so no code breaks.)*

**Code scoping** (§4) lands between the two migrations. Tree stays green (nullable `shopId`, existing uniques still hold for one shop).

**Migration 2 — CONTRACT (tighten, ships with the scoped code):**
1. `SET NOT NULL` on every `shopId`.
2. Swap global uniques → composite (§2c).
3. Re-key `StoreConfig` (`shopId` PK) and both counters (`@@id([shopId, fy])`).

---

## 6. Sessionless paths (no user session → explicit shop context)

| Path | Handling |
|---|---|
| Crons `day-end`, `khata-reminders`, `stock-alerts` | Loop over all shops; run per-shop (per-tenant totals/alerts). Trivial while one shop exists. |
| Crons `reservation-expiry`, `reconcile-batches` | Run system-wide; derive `shopId` per row for the audit entry. |
| Cron `backup` | Stays global (whole-DB `pg_dump`). |
| Webhook `markPaid` (dormant, Razorpay off) | Derive `shopId` from the matched Order; stamp it on ProcessedWebhook/Payment. Wire when re-enabled. |
| Seed `seed.ts` | Create **Shop #1 first**, then key StoreConfig + StaffUser to it; Permissions/Roles stay global. |
| Seed `seed-demo.ts` | Take a target `shopId` (env/arg); all upsert keys become shop-scoped. |
| Storefront public routes (products/brands/categories) | Resolve the shop from a helper (single shop today → env `DEFAULT_SHOP_SLUG`/first shop; host/subdomain later). |

---

## 7. Execution buckets (file-exclusive → parallel after the foundation)

- **Bucket 1 — Foundation (me, lands first):** schema expand + migration 1, `Session.shopId` + `resolveSession`, `requireShop`, `audit` kernel `shopId`, and the **frozen kernel signatures**.
- **Bucket 2 — Catalog + Pricing + Import:** `catalog/service.ts`, `pricing/service.ts`, `import/service.ts`.
- **Bucket 3 — Inventory + Jobs:** `inventory/service.ts` (owns stock kernels), `jobs/*`.
- **Bucket 4 — Billing + Numbering + Ledger:** `billing/service.ts`, `billing/numbering.ts`, `ledger/service.ts` (owns numbering + ledger kernels + counter re-key).
- **Bucket 5 — Orders + Reports + Dashboard + Settings:** `orders/service.ts`, `reports/*`, `dashboard/service.ts`, `settings/service.ts`.

Bucket 5 codes against the frozen signatures from 3 & 4 and integrates last. No two buckets touch the same file.

---

## 8. Test plan (the real gate — reads aren't compiler-checked)

- **Isolation tests** per module: seed Shop A + Shop B with overlapping data (same SKU, same customer phone, same FY invoice series). Assert:
  - A read scoped to A never returns B's rows.
  - `Product.sku` / `Brand.name` / `Unit.code` collide across shops without error (composite unique works).
  - Invoice numbering is independent per shop (both start at `…/000001`).
  - `groupBy`/report totals for A exclude B.
  - A by-id fetch of B's row from A's context returns null / throws.
- Existing unit tests updated to pass `shopId` in their ctx/kernels.
- `pnpm -r typecheck` green (proves every create/kernel sets `shopId`).

---

## 9. Progress
- [x] Bucket 1 — foundation (`Shop`, `Session.shopId`, `requireShop`, `resolveSession`, `audit` shop-stamped, `platform/shops` resolver)
- [x] Buckets 2–5 — every core query scoped by `shopId` (kernels, numbering row-lock, stock raw-SQL, nested creates)
- [x] App-layer wiring — admin pages/actions/layouts (27 files), admin API routes (24 incl. 4 public via `publicShopId`), storefront (17), cron routes fan out per shop, seed + seed-demo bootstrap Shop #1, `registerCustomer` shop-scoped
- [x] Contract schema — `shopId NOT NULL` (except ProcessedWebhook/IdempotencyKey), composite uniques, per-shop counters + StoreConfig
- [x] **Verified:** all 8 packages typecheck green (compiler proves every `create` sets `shopId`); 174 unit tests pass; read-scoping audit (storeConfig + every groupBy/aggregate carry `shopId`)
- [x] Migration file written & data-safe (`20260801120000_p0_multitenant` — expand→backfill→contract in one) — **ready to apply, NOT yet applied to the live DB**
- [ ] **Apply migration on Neon** — validate on a branch, then deploy (owner action)
- [ ] Runtime 2-shop isolation tests — needs a migrated test DB (blocked on the above)
