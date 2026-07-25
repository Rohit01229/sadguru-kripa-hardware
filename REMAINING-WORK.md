# Remaining Work — to complete the project

Everything left to take this from "scaffolded foundation" to a shippable v1. Tiers: **[M]** must-have for v1 · **[N]** nice-to-have · **[F]** future/phase-2. Detail lives in `docs/architecture/11-scaffolding-plan.md`, `…/13-data-architecture.md`, and `docs/documentation/req_v1/02-feature-proposal.md`.

> Done already: full design docs; monorepo with `config`/`core`/`auth`/`ui` (tested green) + `db` schema + `admin`/`storefront` skeletons. See `SCAFFOLDING.md`.

---

## 0. Get it running (do first)
- [ ] Hosted Postgres (Neon/Supabase); URLs in `packages/db/.env` → `db:generate` + `db:migrate:dev` (see `START-HERE.md`).
- [ ] `pnpm install`, `pnpm dev` — confirm both apps boot.

## 1. Finish the foundation [M]
- [ ] **Grow the Prisma schema** from the foundation subset to the full model (`13-data-architecture.md`): PriceSlab, Batch, Reservation, Supplier/GoodsReceipt/GrnLine, Customer/Address/LedgerEntry, Invoice/InvoiceLine/Payment/CreditNote/CreditNoteCounter, Order/OrderLine, ProcessedWebhook.
- [ ] **Implement the DB-touching core services** (stubbed today): `decrementStock` + reserve/release (03 §5), `nextInvoiceNo` (03 §7), `finalizePakka` / `finalizeKacha` (03 §6), tax orchestration (03 §8), ledger ops, `audit()` writes.
- [ ] **RBAC wiring**: resolve roles→permissions per session; `requirePermission` on every mutation; seed `OWNER` + all permission keys.
- [ ] **Auth**: `pnpm add next-auth@beta @auth/prisma-adapter`; finish realm configs; DB-session strategy for credentials; email-verify + password-reset flows; rate-limit/lockout on auth endpoints.
- [ ] **Logger + correlation-id middleware** in both apps; Sentry init + `beforeSend` redaction.

## 2. Stock / Inventory module
- [ ] [M] Product CRUD UI — base unit + **multiple sale units** + conversion factors, HSN, GST rate, MRP/sale price.
- [ ] [M] Categories, brands, units management.
- [ ] [M] **Quantity-break price slabs** UI.
- [ ] [M] Stock-in (**GRN**) + supplier records; manual adjustments (+reasons); sales/purchase returns.
- [ ] [M] **Batch + optional expiry**; near-expiry alerts.
- [ ] [M] Low-stock / reorder-level alerts.
- [ ] [M] **Barcode**: scan at billing; search-by-name/code for loose items.
- [ ] [M] **CSV/Excel bulk import** (products + opening stock).
- [ ] [M] Stock reports: on-hand, valuation, movement history, near-expiry.
- [ ] [N] Product images (R2 upload). · [N] Supplier dues/payables. · [F] barcode label printing · [F] variants.

## 3. Ecommerce module (B2C + B2B)
- [ ] [M] Storefront: category browse, **search/filter**, product page with **unit options + live stock**.
- [ ] [M] **Cart + checkout**.
- [ ] [M] **Customer accounts**: register → verify email → login; password reset; profile, addresses, **order history**, reorder.
- [ ] [M] **Order flow**: reserve stock on placement (atomic + TTL); admin order screen accept→pack→dispatch→complete; **pakka invoice generated on dispatch**.
- [ ] [M] Delivery: **local delivery + store pickup**; **flat fee, free above threshold**.
- [ ] [M] **Payments**: Razorpay (server-side order, hosted checkout, **webhook verify + idempotency**, mark paid) **and** pay-at-store/on-delivery; refunds for returns.
- [ ] [M] **Quantity-break pricing** visible to all; **GSTIN capture** at checkout.
- [ ] [M] Order-status **notifications** (email via Resend).
- [ ] [N] SMS (MSG91/DLT). · [N] Coupons/promotions. · [N] B2B RFQ/quote. · [N] material calculators. · [F] WhatsApp.

## 4. Admin Billing module
- [ ] [M] **POS billing UI**: fast add by search/barcode, pick sale unit, qty, line/bill discounts, **manual rate override**, round-off.
- [ ] [M] **Kacha bill**: no-tax print, **zero-trace** (only a `KACHA_OUT` movement), one-click **convert→pakka** before finalize.
- [ ] [M] **Pakka bill**: full GST tax invoice, **gapless numbering**, HSN, CGST/SGST/IGST, place-of-supply.
- [ ] [M] **Payment modes**: cash (+change), UPI, card, **credit/khata + part-payment**.
- [ ] [M] **Print templates**: thermal 2"/3" + A4/A5 (selectable); logo/GSTIN/address/bank details/T&C/signature.
- [ ] [M] **Khata ledger**: customer outstanding, **dues aging**, record payments, reminders.
- [ ] [M] **Returns / credit notes** vs pakka (partial, refund modes); **invoice cancel/amend** flow.
- [ ] [M] **GSTR-1 + HSN summary export**.
- [ ] [M] Day-end summary + sales reports (day/item/category/payment mode).
- [ ] [N] e-Way bill (>₹50k). · [N] saved quotation/estimate. · [N] delivery challan. · [F] e-Invoice/IRN (if turnover ≥ ₹5 cr).

## 5. Cross-cutting
- [ ] [M] **Audit/void log** writes on all sensitive ops + a viewer.
- [ ] [M] **Dashboard**: today's sales, low stock, dues, top items.
- [ ] [M] **Background jobs** (Vercel Cron + QStash): reservation-expiry, khata reminders, day-end roll-up, near-expiry/low-stock alerts.
- [ ] [M] **Backups**: automated encrypted `pg_dump` → R2; 6-year retention; restore drill.
- [ ] [M] Security finishing: headers/CSP final, least-privilege DB role, secret management.
- [ ] [M] `StoreConfig` admin screen (shop name, GSTIN, home state, logo, bank, terms, delivery fee/threshold, reservation TTL, rounding mode).
- [ ] [N] Owner 2FA (TOTP). · [N] OpenTelemetry tracing.

## 6. Quality, CI/CD & delivery
- [ ] [M] **Integration tests** (Dockerised Postgres) for `decrementStock` + gapless numbering; **e2e (Playwright)** for the key slices; expand unit coverage.
- [ ] [M] **CI/CD** (GitHub Actions): lint/typecheck/test/build + integration/e2e; **Dependabot + pnpm audit + gitleaks**; preview deploy per PR (Vercel + Neon branch); `migrate deploy` on main.
- [ ] [M] **Seed**: owner + RBAC + sample UoM catalog/stock.
- [ ] [M] **Dockerfiles** per app + `docker-compose` (VPS option).

## 7. Go-live
- [ ] [M] Pick **hosting** (Vercel Pro ~₹2,100/mo *or* Mumbai VPS ~₹450/mo) — paid, commercial.
- [ ] [M] **Domain + DNS + TLS**; production env/secrets; **Razorpay live keys** + webhook secret.
- [ ] [M] Fill **StoreConfig** (GSTIN, logo, bank, terms, home state).
- [ ] [M] **UAT with the shop owner**; staff handover/training.
- [ ] [M] Backup schedule live; **runbook** (incident, secret rotation, restore drill).
- [ ] [N] WhatsApp Business API (DLT + templates) if used. · [N] confirm data residency.

## 8. Decisions still open (TBD — settle during build)
- [ ] Reservation TTL value · decimal scale for qty · per-line vs per-invoice GST rounding (with the accountant) · credit-note series format · negative-stock defaults for adjustments/returns · exact admin/storefront domains.

---

### Rough sequencing
**1 (foundation)** → **4 (billing)** + **2 (stock)** in parallel → **3 (ecommerce)** → **5 (cross-cutting)** → **6 (quality/CI)** → **7 (go-live)**. Billing + stock are the shop's daily core, so prioritise them; ecommerce can follow.
