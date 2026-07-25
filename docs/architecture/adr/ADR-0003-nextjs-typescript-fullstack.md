# ADR-0003: Next.js (App Router) + TypeScript full-stack

**Status:** Accepted · 2026-06-24

## Context
We need a framework for both delivery surfaces (`ADR-0002-turborepo-monorepo.md`). Requirements pull in two directions: the **storefront** needs server-side rendering for SEO and fast first paint (`../09-nfr.md` NFR-PERF-05), while the **admin/POS** needs snappy CRUD and a keyboard-first counter flow (NFR-USE-01). For a solo/small build, minimizing moving parts is a top goal, and the existing repo already points at Prisma + TypeScript.

## Decision
Build **full-stack on Next.js (App Router) with TypeScript** — UI, **route handlers**, and **server actions** in one toolchain, with React + Tailwind + shadcn/ui for the front end. No separate standalone backend service in v1. Shared TypeScript types flow from `@hardware/db` and `@hardware/core` into both apps. Validation uses **Zod** on form + API + DB inputs.

## Consequences
**Positive**
- One language end-to-end (TS) and one framework halves the moving parts vs UI + separate API server — directly serves the fast-dev goal.
- Server actions make billing/CRUD flows terse and type-safe from client to DB; route handlers cover webhooks and integration endpoints.
- SSR/ISR gives the storefront good SEO and LCP; the admin app can stay mostly dynamic/server-rendered.
- Shared types eliminate a class of client/server mismatch bugs (NFR-MNT-01).
- Large ecosystem and Vercel-native deploy keep both build and hosting simple (`ADR-0010-hosting-free-then-paid.md`).

**Negative / tradeoffs**
- Serverless functions have **cold starts**, which hurt POS latency on free tiers — the explicit reason a warm paid tier is required at go-live (`../09-nfr.md` NFR-AVL-03; `ADR-0010-hosting-free-then-paid.md`).
- App Router + server actions + RSC have real conceptual complexity and evolve quickly; version pinning is required (`../01-tech-stack.md`).
- Coupling UI and API in one framework is convenient now but means an API-only consumer (e.g., a future mobile app) would need either route handlers exposed deliberately or a later extract — anticipated by the modular monolith.

## Alternatives considered
- **Separate backend (NestJS/Express) + separate frontend (Vite/React)** — cleaner API/UI separation, but more services, more plumbing, and two deploys; rejected for v1 as over-engineering.
- **Remix / SvelteKit / other full-stack frameworks** — capable, but smaller ecosystem fit with Prisma + Vercel + shadcn and less team familiarity; rejected.
- **Pure SPA + standalone API** — loses SSR/SEO for the storefront and adds an API tier; rejected.

See also: `ADR-0001-modular-monolith.md`, `ADR-0004-postgresql-on-neon.md`, `../09-nfr.md` (NFR-PERF, NFR-MNT).
