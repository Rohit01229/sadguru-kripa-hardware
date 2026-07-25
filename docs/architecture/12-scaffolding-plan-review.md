# Scaffolding Plan — Critical Review

**Status:** DRAFT · 2026-06-24 · ✅ **all P0+P1 fixes applied to `11-scaffolding-plan.md` (Round 2)**; CI test DB = Dockerised Postgres
A critique of `11-scaffolding-plan.md` against the architecture suite (esp. `07-security`, `08-observability`, `10-rbac`, `03-technical`, `05-infrastructure`) and the tech stack. Lens: **execution-readiness** — would a developer following this plan end up with a skeleton that actually runs and matches the locked design?

## Rating
**7 / 10.** Well-sequenced, gated, vertical-slice-first, and faithful to the monorepo layout + infra. It loses points because it **under-scaffolds the security/RBAC/observability foundation the arch docs treat as day-one**, contains **one design contradiction** (`requireRole` vs the permission-based RBAC model), and **omits two tech-stack details that would stop the build** (`transpilePackages`, Prisma `generate` wiring). Fixable with one focused pass.

## What's genuinely strong
- **Phase gates** ("how you know it's done") on every phase — rare and valuable.
- **Vertical slice first** (Phase 7 proves UI→action→core→Prisma→Neon) de-risks integration early.
- Carries the real conventions: import boundaries, server-actions-vs-route-handlers, pooled-vs-direct URLs, `Decimal`/paise.
- Honest about scope and even flags the `06-data-architecture.md` doc gap itself.

---

## P0 — Blockers (plan as written won't build, or violates a locked design)

**1. Missing `transpilePackages` + Prisma `generate` wiring (tech-stack correctness).**
A Turborepo + Next.js app importing workspace packages **must** list them in `next.config` `transpilePackages` (`@hardware/ui`, `@hardware/core`, `@hardware/auth`), and the Turbo pipeline **must** run `prisma generate` before any app build (`@hardware/db#build` as an upstream dep). The plan has neither — so Phases 7–8 wouldn't compile as written.
→ *Fix:* add a `generate` task + `dependsOn: ["^db:generate"]` to `turbo.json` (Phase 1/2) and `transpilePackages` to each app (Phase 7/8).

**2. RBAC isn't scaffolded — and the plan contradicts `10-rbac.md`.**
`10 §3/§5/§6` mandates a **permission-based** model: tables `Permission / Role / RolePermission / UserRole`, a guard `requirePermission(session, 'resource.action')` / `can()`, permission keys seeded from a `@hardware/core` constant, OWNER = all permissions, and **"never branch on `role`."** The plan's Phase 3 schema omits these tables and **Phase 5 proposes `requireRole(role)`** — the exact anti-pattern `10 §6` forbids.
→ *Fix:* add the four RBAC tables to the Phase 3 initial migration; add the permission-key constant + `requirePermission`/`can` guard to Phase 4; seed `OWNER`→all-permissions in Phase 11; delete `requireRole`.

**3. Realm separation (staff vs customer) isn't scaffolded.**
`10 §2.3` + `07 §1`: staff and customers are **different account tables, different Auth.js providers, different cookie scopes** — a customer session must *never* be elevatable to admin. The plan wires a single `@hardware/auth` credentials setup and a shared login, never splitting the two identity domains.
→ *Fix:* Phase 3 schema = separate `StaffUser` vs `Customer` models; Phase 5 = two Auth.js configs (admin realm / storefront realm) with distinct cookie names/scopes; Phases 7/8 each mount their own.

**4. Audit/void log absent from the foundation.**
A locked must-have and the integrity backbone (`07 §10`, `10 §7`, `03`). The plan's initial models don't include it and no core helper writes it — yet sensitive ops (invoice cancel, credit note, rate override, khata adjust, kacha stock-out) must be audited from day one.
→ *Fix:* add an append-only `AuditLog` model (`actorUserId, roleAtTime, permissionUsed, action, targetId, before, after, requestId, ts`) to Phase 3 and an `audit()` helper in Phase 4 that sensitive services call inside their transaction.

---

## P1 — Important (security/quality baseline the docs require; skeleton is incomplete without)

**5. No security headers / CSP / CSRF (`07 §8`).** Add `next.config` headers (`HSTS`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) + a starter **CSP** (`default-src 'self'`; allow Razorpay checkout + R2 images; `frame-ancestors 'none'`) and note the server-action CSRF posture. → Phase 7/8.

**6. No rate-limiting / lockout wiring (`07 §1`, `06`).** `@upstash/ratelimit` on **login / reset / verify** (per-IP + per-account) with backoff + lockout. The plan uses Upstash only for QStash. → Phase 5/9.

**7. Email-verification + password-reset flows unscaffolded (`07 §1`).** Single-use **hashed, expiring** tokens; enumeration-safe responses; verify-before-credit-order. At least scaffold the token model + endpoint stubs. → Phase 5.

**8. Observability utility missing (`08 §1`).** A **structured JSON logger** in `@hardware/core` with **correlation/request IDs** and a **redaction never-log list** (passwords, tokens, cookies, GSTIN, phone, email, card), wired into Sentry `beforeSend`. The plan inits Sentry but has no logger/correlation/redaction. → logger in Phase 4; request-ID middleware in Phase 7/8.

**9. Testing is too thin to satisfy the gates (`09-nfr` maintainability; `03 §5/§7`).** The riskiest code — the atomic `$executeRaw` stock decrement and gapless invoice numbering — **cannot** be verified by the plan's pure unit tests; they need **integration tests against a real Postgres** (Neon test branch or a Dockerized PG service in CI) and an **e2e smoke (Playwright)** for the Phase-7 slice. → add a test-DB strategy to Phase 4, e2e to Phase 7, and run both in CI (Phase 10).

**10. CI security scanning missing (`07 §9`).** Phase 10 lists lint/typecheck/test/build but not **Dependabot**, **`pnpm audit` (fail on high/critical)**, and **gitleaks** (block on committed secrets). → Phase 10.

**11. Least-privilege DB roles not set up (`07 §3`, `05 §6`).** The app should connect as a role that **cannot run destructive DDL**; migrations use a **separate** credential. The plan distinguishes pooled vs direct URLs but not privilege. → Phase 3/10.

---

## P2 — Improvements / smaller
- **Prisma `Decimal` serialization** across server actions / RSC: `Decimal` isn't JSON-serializable by default — standardize a boundary convention (superjson, or convert to integer **paise**/string per `04`) so it isn't discovered painfully mid-build.
- **`ProcessedWebhook` + `Reservation` tables** (`03 §5/§9`) should appear in the explicit schema-growth sequence, not only Phase-9 prose.
- **2FA (owner TOTP) model** (`07 §1`): scaffold `TotpSecret` + hashed recovery codes as deferred-config even if disabled.
- **Sentry source maps + `beforeSend` redaction** (`08 §2`) in build/CI, not just release tagging.
- **GSTIN format/checksum + HSN→rate** validation placeholders in catalog/billing input (`07 §3`, `03 §8`).
- **Ops docs as TBD**: incident runbook, secret-rotation, restore-drill (`05`, `08`) — note as post-scaffold.

---

## Fixes mapped to phases
| Fix | Severity | Lands in phase |
|-----|----------|----------------|
| `transpilePackages` + `prisma generate` in turbo pipeline | P0 | 1–2, 7–8 |
| RBAC tables + permission guard + seed; drop `requireRole` | P0 | 3, 4, 11 |
| Staff/Customer realm-separated auth | P0 | 3, 5, 7–8 |
| `AuditLog` model + `audit()` helper | P0 | 3, 4 |
| Security headers + CSP + CSRF note | P1 | 7–8 |
| Rate-limit/lockout (`@upstash/ratelimit`) | P1 | 5, 9 |
| Email-verify + password-reset token models/flows | P1 | 5 |
| Structured logger + correlation IDs + redaction | P1 | 4, 7–8 |
| Integration tests (real PG) + Playwright e2e + CI test DB | P1 | 4, 7, 10 |
| Dependabot + pnpm audit + gitleaks in CI | P1 | 10 |
| Least-privilege app DB role + migration role | P1 | 3, 10 |
| Decimal serialization convention | P2 | 4 |
| ProcessedWebhook/Reservation in schema-growth list | P2 | 3/9 |
| TOTP model (deferred) · Sentry source maps · GSTIN/HSN utils | P2 | 5/10/4 |

## Net effect on scope
These don't bloat the build — most are **wiring and small models**, not features. The schema's **initial migration grows** from "auth + UoM core" to "**realm-split auth + RBAC + audit log + UoM core**", Phase 4 gains a **logger + permission guard + audit helper**, Phase 10 gains **security scanning + a CI test DB**, and apps gain **headers + transpilePackages**. That is the difference between a skeleton that *looks* right and one that's actually faithful to `07`/`08`/`10` and *runs*.

## Two decisions for you
1. **Confirm we scaffold permission-based RBAC + realm-separated auth in v1** (recommended — the docs assume it from day one; retrofitting later is painful), or accept a simpler single-auth now and refactor later (not recommended).
2. **CI test-database approach** for the integration tests: **Neon branch per CI run** (closest to prod, needs API wiring) vs **Dockerized Postgres service** in the Actions job (simplest, fully local) vs **Testcontainers**.
