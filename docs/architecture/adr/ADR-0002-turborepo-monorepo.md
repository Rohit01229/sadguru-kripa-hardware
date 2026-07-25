# ADR-0002: Turborepo monorepo (apps + shared packages)

**Status:** Accepted · 2026-06-24

## Context
The modular monolith (`ADR-0001-modular-monolith.md`) needs a code-organization scheme. There are two distinct delivery surfaces — an **owner/admin** app (stock, billing, ledger, reports) and a **customer storefront** (catalog, cart, orders) — but they must share one database schema, one set of domain rules, one auth configuration, and a common UI kit. We want to avoid both extremes: a single tangled app, and two independent repos that duplicate types and drift apart.

## Decision
Use a **Turborepo monorepo with pnpm workspaces**, structured as:

```
hardware/
├─ apps/
│  ├─ admin/        # Next.js — owner: stock, billing (kacha/pakka), ledger, reports
│  └─ storefront/   # Next.js — customers: catalog, cart, orders
├─ packages/
│  ├─ db/           # Prisma schema + client — single source of truth
│  ├─ core/         # domain logic: inventory, billing, ledger, pricing, UoM
│  ├─ auth/         # Auth.js config shared by both apps
│  ├─ ui/           # shared shadcn/ui components
│  └─ config/       # shared tsconfig / eslint / tailwind presets
```

Both apps import `@hardware/db` and `@hardware/core`, so there is **one database and one set of business rules** — the modular-monolith benefit, even with two deployables.

## Consequences
**Positive**
- One Prisma schema and one domain layer → no type drift, no duplicated business rules (`../09-nfr.md` NFR-MNT-01/06).
- Turborepo task caching + pnpm = fast installs and incremental CI builds (NFR-MNT-04); GitHub Actions uses the remote cache.
- Shared `ui`/`config` packages keep both apps consistent and accessible with little effort.
- Admin and storefront can be deployed and scaled independently while still sharing core logic.
- Clean home for future extracted services — they can live as new packages/apps without a restructure.

**Negative / tradeoffs**
- Monorepo tooling (Turborepo, workspace protocols, build ordering) has a learning curve and some config overhead.
- A change to a shared package (`core`/`db`) can ripple to both apps — caught by typecheck + tests in CI, but requires care.
- Slightly more complex deploy wiring than a single app (two Vercel projects, shared env).

## Alternatives considered
- **Single Next.js app serving both `/admin` and storefront** — viable and simpler, but blurs the very different audiences, auth boundaries, and scaling profiles; rejected in favor of two apps over a shared core.
- **Two separate repositories** — rejected: would duplicate Prisma schema, types, and domain logic and invite drift; loses the single-source-of-truth guarantee.
- **Nx instead of Turborepo** — comparable capability; Turborepo chosen for a lighter footprint and tight Next.js/Vercel fit. Not load-bearing — could be revisited.

See also: `ADR-0001-modular-monolith.md`, `ADR-0003-nextjs-typescript-fullstack.md`, `ADR-0004-postgresql-on-neon.md`.
