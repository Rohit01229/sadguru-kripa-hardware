# Scaffolding — Build Progress & Local Setup

Tracks execution of [`docs/architecture/11-scaffolding-plan.md`](docs/architecture/11-scaffolding-plan.md).

## Status
| Phase | State | Verified in sandbox |
|-------|-------|---------------------|
| 1 — Repo & workspace | ✅ done | `pnpm install` + `turbo build` pass |
| 2 — `packages/config` | ✅ done | `eslint` + `tsc` pass |
| 3 — `packages/db` (foundation schema) | ⏳ authored | schema written & reviewed; **Prisma `generate`/`migrate` must run locally** (see below) |
| 4 — `packages/core` (primitives) | ✅ done | lint + tsc clean; **15 unit tests pass** (uom, tax, rbac, money, logger, numbering). DB-touching services (`decrementStock`, `nextInvoiceNo`) stubbed until the client generates |
| 5 — `packages/auth` (password/tokens/ratelimit) | ✅ done | lint + tsc clean; **5 unit tests pass** (argon2id hash/verify, token issue/verify). Realm Auth.js configs authored under `src/nextauth/` (typecheck after `generate`) |
| 6 — `packages/ui` (components) | ✅ done | lint + tsc clean (`Button`, `cn`) |
| 7 — `apps/admin` (skeleton) | 🟡 authored | next.config (transpilePackages + headers/CSP), zod env, middleware, layout, dashboard slice (`core.listProducts`), healthz/readyz, login UI. Runs after `pnpm install` (Next) + `generate` + DB |
| 8 — `apps/storefront` (skeleton) | 🟡 authored | next.config, zod env, layout, catalog page, healthz. Same prerequisites |
| 9–11 | ⏳ pending | integrations → CI/CD → seed |

The foundation schema (`packages/db/prisma/schema.prisma`) covers auth realms + RBAC + audit + UoM core + counters + StoreConfig, per [`13-data-architecture.md`](docs/architecture/13-data-architecture.md). The remaining tables (billing, orders, ledger, etc.) are grown in later phases.

## Finish Phase 3 on your machine
The sandbox can't reach Prisma's engine host or a database, so run these locally:

1. **Install:** `corepack enable && pnpm install` (or `npm i -g pnpm@9 && pnpm install`).
2. **Hosted Postgres** (Neon / Supabase / Railway — see [`packages/db/README.md`](packages/db/README.md) for provider specifics): put the **pooled** + **direct** URLs in `packages/db/.env`:
   ```env
   DATABASE_URL="<pooled connection string>"
   DIRECT_URL="<direct connection string>"
   ```
   A consolidated template for all services is in the root `.env.example`.
3. **Generate + migrate:**
   ```bash
   pnpm --filter @hardware/db db:generate
   pnpm --filter @hardware/db db:migrate:dev   # creates the initial migration
   ```
4. After `db:generate`, `pnpm --filter @hardware/db typecheck` passes (it needs the generated client).

## Sandbox notes (why two steps were deferred)
- **Delete-restricted mount:** your folder is read/write but blocks deletes, which breaks `pnpm`'s temp-file cleanup and `git`. Source-of-truth files live in your folder; installs/builds were verified in an off-mount copy.
- **`binaries.prisma.sh` blocked:** Prisma's engine download is not reachable from the sandbox, so `prisma generate`/`migrate` (and the engine-dependent typecheck of `packages/db`) run on your machine, not here.

## Verified toolchain
Node 22 · pnpm 9.15.9 · Turborepo 2.9 · TypeScript 5.9 · ESLint 9 · Vitest 2.1 · Prisma 6.19 (resolved). pnpm installs and the Turbo pipeline work; `@hardware/config` and `@hardware/core` lint + typecheck clean; core's 15 unit tests pass.

## What core proves (Phase 4)
The load-bearing logic is implemented and tested without a database:
`uom.toBaseQty` (coil→metre conversion, fractional-piece guard) · `tax.computeLineTax` (CGST/SGST vs IGST by place of supply) + `backCalcTaxable` · `rbac.can/requirePermission` · `money` (rupee↔paise, round-to-rupee) · `billing.financialYear/formatInvoiceNo` (gapless numbering) · `logger.redact` (PII/secret masking).

## Run the apps locally
After the hosted-DB steps above:
```bash
pnpm install            # pulls Next, React, Tailwind for the apps
pnpm --filter @hardware/db db:generate
pnpm dev                # admin on :3001, storefront on :3000
```
The admin dashboard and storefront catalog read through `@hardware/core` (showing 0 products until you seed). Wire login to the Auth.js realm configs in `packages/auth/src/nextauth/` after `pnpm add next-auth@beta @auth/prisma-adapter`.

## Verified so far
**5 packages** built and green (`config`, `core`, `auth`, `ui` — lint + typecheck; `db` schema authored); **20 unit tests pass** (15 core + 5 auth); installs, Turbo build, lint, and typecheck all clean off-mount. **2 app skeletons** (`admin`, `storefront`) authored — they boot after `pnpm install` + `db:generate` + DB.

## Remaining (Phases 9–11)
Integrations (Razorpay webhook + idempotency, R2 uploads, cron jobs), CI/CD (GitHub Actions + Dockerised Postgres tests + gitleaks/audit), and the seed (owner + RBAC + sample UoM data) — all specified in `docs/architecture/11-scaffolding-plan.md`.
