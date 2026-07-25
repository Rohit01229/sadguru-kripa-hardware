# Non-Functional Requirements (NFRs)

**Status:** DRAFT · 2026-06-24
Quantified quality attributes for the hardware-store web app (single store, India, GST-registered, turnover < ₹5 cr). Functional scope lives in `../documentation/req_v1/02-feature-proposal.md`; architecture in `00-overview.md`, `02-solution-architecture.md`, `03-technical-architecture.md`; security in `07-security-architecture.md`; observability in `08-observability-architecture.md`.

> ⚠️ **All numeric thresholds below are PROPOSED TARGETS, not contractual SLAs.** They are sized for a single shop with a 500–5,000 SKU catalog and a counter POS that must feel instant. They will be confirmed (or revised) against real measurements once a paid hosting tier is live — see the verification note at the end. Genuinely open points are marked **TBD**.

Each requirement has a stable ID (`NFR-<CATEGORY>-NN`) so it can be referenced from tests, dashboards, and review notes.

---

## 1. Performance (`NFR-PERF`)

The counter POS is the most latency-sensitive surface: a cashier billing a queue must never wait on the UI. The storefront is SEO- and conversion-sensitive, so page-load matters there.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-PERF-01 | POS "add item to bill" — UI response after barcode scan / typeahead select | **< ~100 ms** client interaction (perceived-instant) | Optimistic UI update; line appears before any server round-trip settles. |
| NFR-PERF-02 | POS product typeahead (search-as-you-type) | first results **< ~300 ms** p95 | Postgres FTS + `pg_trgm` over ≤5k SKUs; debounce input; cache hot queries. |
| NFR-PERF-03 | Pakka bill finalize (persist invoice, allocate gapless number, decrement stock) | **p95 < ~1.5 s** | End-to-end server action incl. DB transaction; excludes printer spool time. |
| NFR-PERF-04 | Kacha bill finalize (stock decrement only — see `adr/ADR-0008-kacha-zero-trace.md`) | **p95 < ~800 ms** | Lighter than pakka (no invoice/tax/ledger writes). |
| NFR-PERF-05 | Storefront product-detail page — Largest Contentful Paint (LCP) | **< ~2.5 s** (75th pct, mobile) | Google "good" threshold; SSR/ISR + R2-served images + CDN. |
| NFR-PERF-06 | Storefront category/list page — Interaction to Next Paint (INP) | **< ~200 ms** | Core Web Vitals "good". |
| NFR-PERF-07 | Admin API route handlers / server actions (read) — server time | **p95 < ~400 ms** | Excludes cold start (see NFR-AVL-03). |
| NFR-PERF-08 | Catalog CSV/Excel bulk import (5k rows) | completes **< ~60 s**, runs async with progress | Batched inserts; not on the request path. |
| NFR-PERF-09 | GSTR-1 / report export (month) | **< ~10 s** for typical single-store volume | Generated server-side; streamed/queued if large. |

**Budget note.** Targets assume a warm paid runtime. On the free Vercel Hobby tier, cold starts (NFR-AVL-03) will breach NFR-PERF-03/04/07 intermittently — acceptable for dev/demo only, which is exactly why a paid tier is mandated at go-live (`adr/ADR-0010-hosting-free-then-paid.md`).

---

## 2. Scalability (`NFR-SCAL`)

Single store, single physical counter, modest online traffic. The design must hold the stated catalog size comfortably and have a clear, incremental headroom path — not premature horizontal scaling.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-SCAL-01 | Catalog size | **≥ 5,000 SKUs** without query tuning beyond Postgres FTS + indexes | Catalog is 500–5k SKUs today; design headroom to ~10k. |
| NFR-SCAL-02 | Concurrent admin/POS users | **1–3** today (single owner login, 1 counter); design for **~10** without rework | RBAC modeled for future cashier/accountant — see `adr/ADR-0011-single-store-owneronly-rbac-extensible.md`. |
| NFR-SCAL-03 | Concurrent storefront sessions | **~100** sustained, **~300** burst (sale day) on paid tier | Stateless app + CDN for static/ISR; DB via pooled connection. |
| NFR-SCAL-04 | Orders / day | hundreds/day without degradation; **TBD** ceiling pending real volume | Reservation + atomic decrement (NFR-REL-01) must hold under burst. |
| NFR-SCAL-05 | DB connections under serverless | never exhaust Neon limits | **Pooled connection mandatory** (Neon pooler / Prisma Accelerate) — see `adr/ADR-0004-postgresql-on-neon.md`. |
| NFR-SCAL-06 | Headroom strategy | documented, incremental | Per `00-overview.md` "scale-later path": ① vertical scale → ② managed Postgres + read replicas + Redis cache → ③ storefront behind CDN → ④ extract busiest module (ecommerce/billing) → ⑤ horizontal-scale stateless containers. Enabled by the modular monolith. |

---

## 3. Availability (`NFR-AVL`)

A shop POS that is down means a queue at the counter, so availability matters disproportionately even at small scale. v1 targets a pragmatic figure and explicitly flags free-tier cold-start risk.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-AVL-01 | Production uptime (v1) | **~99.5% / month** (≈ 3.6 h downtime/mo) | Modest, single-region target; revisit upward post-launch. |
| NFR-AVL-02 | Storefront availability | **~99.5%**, ≥ NFR-AVL-01 | CDN-fronted static/ISR survives brief origin blips. |
| NFR-AVL-03 | Free-tier cold-start risk | **acknowledged, not accepted for live POS** | Vercel Hobby cold starts make POS feel sluggish/unreliable; dev/demo only. **Go-live REQUIRES** a paid warm tier (Vercel Pro or Mumbai VPS) — `adr/ADR-0010-hosting-free-then-paid.md`. |
| NFR-AVL-04 | POS degraded / offline mode | **TBD** | App is online-only in v1 (`02-feature-proposal.md` Decision 4). A future local cache / queued-write fallback for short outages is a candidate; not committed. Mitigation today = reliable paid hosting + uptime alerting. |
| NFR-AVL-05 | Planned-maintenance windows | low-traffic only (e.g., early morning/night), pre-announced | Most migrations are online (additive). |
| NFR-AVL-06 | Dependency degradation (Razorpay/SMS/email down) | core billing stays usable | Cash/UPI-manual/credit billing must not hard-depend on the gateway; gateway failures are isolated and retried — see NFR-REL-04 and `adr/ADR-0006-razorpay-payments.md`. |

---

## 4. Reliability & Consistency (`NFR-REL`)

Money and stock must always agree. This is the integrity backbone of the system; these requirements are non-negotiable even though the numbers elsewhere are soft.

| ID | Requirement | PROPOSED TARGET / RULE | Notes |
|----|-------------|------------------------|-------|
| NFR-REL-01 | **No overselling** of shared inventory | **0 oversells** under normal + burst load | One shared stock pool across POS + ecommerce; stock decrement is an **atomic DB transaction**; orders **reserve** stock on placement. See `03-technical-architecture.md`. |
| NFR-REL-02 | Order reservation timeout | abandoned-cart reservation auto-releases (window **TBD**, e.g., ~15–30 min) | Prevents phantom stock-out; released via cron/QStash job. |
| NFR-REL-03 | **Gapless pakka invoice numbering** | **no gaps, no duplicates, ever** | Sequential per statutory series; allocated inside the finalize transaction; **no deletes** — cancel/credit-note instead (`02-feature-proposal.md`). See `adr/ADR-0009-einvoice-deferred.md` for GST context. |
| NFR-REL-04 | **Idempotent payments** | a webhook/retry never double-credits or double-books an order | Razorpay webhook **signature verified**; idempotency key per order; replays are no-ops — `adr/ADR-0006-razorpay-payments.md`. |
| NFR-REL-05 | Kacha→pakka conversion correctness | converting a kacha bill before finalize produces exactly one consistent pakka invoice + stock state | Kacha itself persists nothing but the decrement (`adr/ADR-0008-kacha-zero-trace.md`). |
| NFR-REL-06 | Khata (credit) ledger integrity | ledger balance == sum of entries at all times | Double-entry-style postings; part-payments reconcile; no orphan entries. |
| NFR-REL-07 | Stock-movement traceability | every stock change (GRN, sale, return, adjustment) has a typed movement record | Exception by design: **kacha decrement is unattributed** and reads as shrinkage/adjustment (accepted tradeoff). |
| NFR-REL-08 | Data validation | all external input validated server-side | One **Zod** schema per entity, shared client+server; Prisma parameterized queries (no SQLi). |
| NFR-REL-09 | Audit / void log | edits, voids, cancellations, credit notes are logged immutably | Financial integrity even with a single user — see `07-security-architecture.md`. |

---

## 5. Durability & Backup (`NFR-DUR`)

GST records must survive for years; a disk/region loss must not lose a day of sales.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-DUR-01 | Production **RPO** (max data loss) | **≤ ~1 hour** | Achieved via Neon Point-in-Time Recovery (PITR) + continuous WAL; tighten if cheaply possible. |
| NFR-DUR-02 | Production **RTO** (max time to restore) | **≤ ~2 hours** | Restore-from-PITR runbook; rehearsed at least once before go-live. |
| NFR-DUR-03 | Automated backups | **daily** logical backup + continuous PITR; **encrypted at rest** | Backups stored encrypted; restore tested periodically — `05-infrastructure-architecture.md`. |
| NFR-DUR-04 | **Statutory retention** | financial/tax records retained **~6 years** | GST record-keeping requirement; pakka invoices, ledgers, GSTR-1 exports retained even after archival. |
| NFR-DUR-05 | Data export | owner can export catalog, invoices, ledger, GSTR-1 on demand | Avoids lock-in and supports the accountant; CSV/Excel/PDF. |
| NFR-DUR-06 | Backup retention schedule | dailies ~30 days, monthlies ~6 years (cold/cheap storage) | Exact tiering **TBD** with chosen host. |

---

## 6. Security & Compliance (`NFR-SEC`)

Baseline in `07-security-architecture.md`; this table fixes the measurable bar. Auth choice in `adr/ADR-0005-authjs-self-hosted.md`.

| ID | Requirement | PROPOSED TARGET / RULE | Notes |
|----|-------------|------------------------|-------|
| NFR-SEC-01 | Transport security | **TLS everywhere**, HSTS on | Platform-managed or Caddy auto-HTTPS on VPS. |
| NFR-SEC-02 | Password storage | **argon2id** hashing; never plaintext | Auth.js credentials provider. |
| NFR-SEC-03 | Session security | httpOnly + Secure + SameSite cookies; sensible expiry | Self-hosted Auth.js v5 sessions. |
| NFR-SEC-04 | Brute-force protection | login **rate-limited**; lockout/backoff | Plus optional 2FA on owner login. |
| NFR-SEC-05 | OWASP Top 10 | no known High/Critical at release | Injection (Prisma+Zod), XSS (React escaping + CSP), CSRF tokens, access control via RBAC checks. |
| NFR-SEC-06 | **PCI scope minimization** | **no card data on our servers** | Razorpay **hosted checkout** only; we store order/payment refs, not PANs — `adr/ADR-0006-razorpay-payments.md`. |
| NFR-SEC-07 | Webhook authenticity | all inbound webhooks **signature-verified** | Reject unsigned/replayed (ties to NFR-REL-04). |
| NFR-SEC-08 | Secrets management | secrets in host/env store, **never in repo**; rotatable | Dependency + secret scanning in CI. |
| NFR-SEC-09 | PII / GSTIN protection | least-privilege DB access; encrypted backups | Customer PII + GSTINs handled per data-minimization. |
| NFR-SEC-10 | **GST compliance** | pakka = valid tax invoice (GSTIN, HSN, CGST/SGST/IGST split, gapless no., place-of-supply); GSTR-1 export | e-Invoice/IRN **deferred** (not legally required < ₹5 cr) — `adr/ADR-0009-einvoice-deferred.md`. |
| NFR-SEC-11 | Data residency | India residency **preferred** at go-live | "No preference" during dev (nearest free region); Mumbai region/VPS option at launch — `00-overview.md`. |
| NFR-SEC-12 | Patching | security patches applied promptly; CI must pass | Renovate/Dependabot proposes upgrades. |

---

## 7. Usability (`NFR-USE`)

The POS is keyboard-first for speed; the storefront is mobile-first for customers.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-USE-01 | **Keyboard-first POS** | full bill (search → add → unit → qty → discount → pay → finalize) completable **without a mouse** | Barcode scan + hotkeys; focus management; numeric entry. |
| NFR-USE-02 | Mouse-free throughput | experienced cashier adds a line in **≤ ~3 s** | Backed by NFR-PERF-01/02. |
| NFR-USE-03 | **Mobile-responsive storefront** | usable on phones (≥ 360 px) and counter PC | Tailwind responsive; touch targets ≥ 44 px. |
| NFR-USE-04 | **Accessibility** | target **WCAG 2.1 AA** for storefront; contrast, labels, focus order | shadcn/ui (accessible primitives) + manual audit; full conformance **TBD**. |
| NFR-USE-05 | Error clarity | validation errors are specific, inline, and recoverable | Zod messages surfaced to the field. |
| NFR-USE-06 | Localization | INR (₹) formatting, Indian number/date formats; English UI v1 | Vernacular UI = future. |
| NFR-USE-07 | Print UX | thermal (2"/3") and A4/A5 selectable per bill | Per `02-feature-proposal.md`. |

---

## 8. Maintainability (`NFR-MNT`)

A solo/small-team build must stay cheap to change. The typed monorepo is the lever.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-MNT-01 | **Typed end-to-end** | TypeScript strict; shared types via `@hardware/db` + `@hardware/core` | One language front-to-back — `adr/ADR-0002-turborepo-monorepo.md`, `adr/ADR-0003-nextjs-typescript-fullstack.md`. |
| NFR-MNT-02 | Automated tests | unit tests on **core domain** (UoM conversion, pricing, tax split, numbering, stock txn, ledger); critical-path integration tests | Coverage target **TBD** (suggest ≥ ~70% on `packages/core`). |
| NFR-MNT-03 | Linting & formatting | ESLint + Prettier enforced in CI; no warnings merged | Shared `config` package presets. |
| NFR-MNT-04 | CI gates | lint + typecheck + test + build must pass before merge | GitHub Actions + Turborepo remote cache. |
| NFR-MNT-05 | Module boundaries | business rules isolated in `packages/core`; apps stay thin | Modular monolith — `adr/ADR-0001-modular-monolith.md`. |
| NFR-MNT-06 | Single source of truth | one Prisma schema (`packages/db`) powers both apps | No schema drift. |
| NFR-MNT-07 | Documentation currency | architecture docs + ADRs updated when a decision changes | This suite; `adr/README.md` index. |
| NFR-MNT-08 | Dependency hygiene | pinned versions; automated upgrade PRs | `01-tech-stack.md` versioning policy. |

---

## 9. Portability (`NFR-PORT`)

Nothing in the build should hard-lock the shop to a single vendor.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-PORT-01 | **Containerized** | app ships as a **Docker** image runnable on any host | Vercel Pro **or** Mumbai VPS from the same artifact — `adr/ADR-0010-hosting-free-then-paid.md`. |
| NFR-PORT-02 | No host lock-in | standard Next.js + Postgres; avoid proprietary primitives where avoidable | Migration path documented in `00-overview.md`. |
| NFR-PORT-03 | DB portability | standard PostgreSQL (Neon today) | Restorable to any Postgres; pooling is the only serverless-specific concern. |
| NFR-PORT-04 | Storage portability | S3-compatible object storage (Cloudflare R2) | Swappable for S3/MinIO. |
| NFR-PORT-05 | Background jobs | Vercel Cron + Upstash QStash now; **pg-boss** if moved to a VPS | Documented switch path — `01-tech-stack.md`. |
| NFR-PORT-06 | Browser support | current evergreen Chrome/Edge/Firefox/Safari (desktop + mobile) | No IE; legacy support out of scope. |

---

## 10. Observability (`NFR-OBS`)

Detailed design in `08-observability-architecture.md`; this fixes the targets.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-OBS-01 | Error tracking | exceptions captured across both apps | **Sentry** (free tier). |
| NFR-OBS-02 | Uptime monitoring | external checks on storefront + admin; alert on outage | **UptimeRobot**; alert within minutes. |
| NFR-OBS-03 | Structured logging | request/transaction logs with correlation IDs; **no PII/secrets/PANs** in logs | Especially around billing + payment flows. |
| NFR-OBS-04 | Key business/perf metrics | track finalize latency, oversell attempts (must be 0), reservation expiries, payment success/failure, webhook retries | Dashboards per `08-observability-architecture.md`. |
| NFR-OBS-05 | Alerting | actionable alerts for downtime, error spikes, failed backups, payment-webhook failures | Routing/severity **TBD**. |
| NFR-OBS-06 | Audit trail visibility | void/cancel/credit-note log is queryable | Ties to NFR-REL-09. |

---

## 11. Cost (`NFR-COST`)

A core optimization goal (`00-overview.md`). Dev must be free; production must stay cheap.

| ID | Requirement | PROPOSED TARGET | Notes |
|----|-------------|-----------------|-------|
| NFR-COST-01 | **Development cost** | **₹0 / month** | Vercel Hobby + Neon free + Upstash free — `adr/ADR-0010-hosting-free-then-paid.md`. |
| NFR-COST-02 | **Production hosting** | **< ~₹3,000 / month** | Target: Vercel Pro ~₹2,100/mo **or** Mumbai VPS ~₹450–1,000/mo. |
| NFR-COST-03 | Per-user auth cost | **₹0** (no per-seat/per-MAU fee) | Self-hosted Auth.js — `adr/ADR-0005-authjs-self-hosted.md`. |
| NFR-COST-04 | Image egress | **₹0 egress** | Cloudflare R2 (no egress fees). |
| NFR-COST-05 | Search cost | **₹0** (no managed search) | Postgres FTS + `pg_trgm` for ≤5k SKUs. |
| NFR-COST-06 | Payments | **~2% + GST per successful txn**, no AMC/setup | Razorpay pass-through cost. |
| NFR-COST-07 | Domain | **~₹900 / year** | Plus usage-billed email/SMS. |
| NFR-COST-08 | Cost scaling | costs rise only with real usage (scale-to-zero DB, usage-billed comms) | Neon scales to zero on free/low tiers. |

---

## How each NFR is verified

Targets are meaningless unless checked. Verification approach by category:

| Category | How verified |
|----------|--------------|
| **Performance** | Lighthouse / Web Vitals (RUM) for storefront LCP/INP; server-timing + Sentry performance traces for finalize/typeahead p95; a scripted POS-flow timing in CI against a seeded ~5k-SKU dataset. Re-measured on the **paid** tier (free-tier cold starts are expected to fail PERF targets). |
| **Scalability** | Load test (e.g., k6) against staging: ramp storefront sessions to target/burst; verify DB connections stay within Neon pool limits; verify catalog queries on a 5k–10k SKU seed. |
| **Availability** | UptimeRobot monthly uptime report vs 99.5%; cold-start risk validated by comparing free vs paid latency; degraded-mode is **TBD** (no test until scoped). |
| **Reliability/Consistency** | **Concurrency tests** that hammer the same SKU from parallel POS+ecommerce buyers and assert 0 oversells; a numbering test asserting no gaps/dupes under concurrency and failure injection; idempotency test replaying a Razorpay webhook and asserting a single effect; ledger-invariant test (balance == Σ entries). These run in CI. |
| **Durability/Backup** | A **rehearsed restore drill** before go-live measuring actual RPO/RTO against ≤1h / ≤2h; backup-success alert (NFR-OBS-05); retention config reviewed against the ~6-year GST rule. |
| **Security/Compliance** | CI dependency + secret scanning; security headers checked (e.g., securityheaders.com); a pre-launch OWASP checklist / lightweight pen-test; GST correctness validated by an accountant against sample pakka invoices + a GSTR-1 export. |
| **Usability** | Manual keyboard-only POS walkthrough (no mouse); Lighthouse accessibility + manual WCAG 2.1 AA spot-check on the storefront; responsive check across breakpoints. |
| **Maintainability** | CI is the gate: lint + typecheck + test + build green before merge; coverage report on `packages/core`. |
| **Portability** | A `docker build` + run-locally smoke test; a documented (and ideally rehearsed) Neon→generic-Postgres restore. |
| **Observability** | Confirm Sentry receives a test error and UptimeRobot a test outage; verify logs carry correlation IDs and contain **no** PII/PANs; confirm a failed-backup alert fires. |
| **Cost** | Monthly review of host + Neon + Upstash + Razorpay + comms bills against the < ~₹3,000/mo target. |

> Anything marked **TBD** above (POS degraded mode, reservation-timeout window, retention tiering, test-coverage %, alert routing, orders/day ceiling) is an open decision to resolve before or shortly after go-live; none blocks the v1 build.
