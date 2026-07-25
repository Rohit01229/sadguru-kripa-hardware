# Hardware Store

Monorepo for the hardware-store system: stock management, an ecommerce storefront, and counter billing (kacha/pakka) for a single GST-registered shop in India.

> **Design docs:** see [`docs/architecture/`](docs/architecture/README.md) (stack, solution, data model, scaffolding plan) and [`docs/documentation/req_v1/`](docs/documentation/req_v1/README.md) (requirements). The build order is [`docs/architecture/11-scaffolding-plan.md`](docs/architecture/11-scaffolding-plan.md).

## Stack
TypeScript · Next.js (App Router) · Prisma + PostgreSQL (Neon) · Auth.js · Tailwind + shadcn/ui · Turborepo + pnpm. Full rationale in [`docs/architecture/01-tech-stack.md`](docs/architecture/01-tech-stack.md).

## Structure
```
apps/
  admin/        # owner: stock, billing, ledger, reports
  storefront/   # customers: catalog, cart, orders
packages/
  db/           # Prisma schema + client (single source of truth)
  core/         # domain logic (no React/Next)
  auth/         # Auth.js config (admin + customer realms)
  ui/           # shared shadcn/ui components
  config/       # shared tsconfig / eslint / tailwind presets
```

## Prerequisites
- Node ≥ 22 (`.nvmrc`)
- pnpm 9 (`corepack enable` or `npm i -g pnpm@9`)

## Getting started
```bash
pnpm install
# configure environment (see .env.example once present)
pnpm db:generate
pnpm db:migrate     # needs a Neon DATABASE_URL / DIRECT_URL
pnpm db:seed
pnpm dev            # runs both apps
```

## Scripts
| Command | What |
|---------|------|
| `pnpm dev` | run all apps in dev |
| `pnpm build` | build everything (Turborepo) |
| `pnpm lint` / `pnpm typecheck` | static checks |
| `pnpm test` / `pnpm test:e2e` | unit/integration · e2e |
| `pnpm db:generate` / `db:migrate` | Prisma client · migrations |

## Status
🟢 Scaffolding in progress (Phase 1+). No business features yet — see the scaffolding plan.
