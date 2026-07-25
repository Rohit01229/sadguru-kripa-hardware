# START HERE — running & resuming the build

The repo is designed and partly built. This is the shortest path to a running app, then how to continue. Per-phase status is in `SCAFFOLDING.md`.

## Step 1 — Tools (once)
- **Node 22+** (see `.nvmrc`).
- **pnpm 9**: run `corepack enable` (or `npm i -g pnpm@9`).

## Step 2 — Install
From the repo root:
```bash
pnpm install
```

## Step 3 — Database (hosted Postgres)
1. Create a free Postgres database — **Neon** (neon.tech) or **Supabase**.
2. Create `packages/db/.env`:
   ```env
   DATABASE_URL="<pooled connection string>"
   DIRECT_URL="<direct connection string>"
   ```
   Pooled-vs-direct details per provider are in `packages/db/README.md`.
3. Generate the client and create the first migration:
   ```bash
   pnpm --filter @hardware/db db:generate
   pnpm --filter @hardware/db db:migrate:dev
   ```

## Step 4 — Run
```bash
pnpm dev
```
- Admin → http://localhost:3001
- Storefront → http://localhost:3000

They'll show **0 products** until you add a seed (Phase 11).

## Step 5 — Login (when you want auth working)
1. Put `AUTH_SECRET` in each app's `.env` (generate with `openssl rand -base64 32`).
2. Install Auth.js and wire the realm configs in `packages/auth/src/nextauth/`:
   ```bash
   pnpm add next-auth@beta @auth/prisma-adapter -w
   ```

## Step 6 — Keep building (Phases 9–11)
Follow `docs/architecture/11-scaffolding-plan.md`, in order:
- **Grow the schema** from the foundation subset to the full model (`docs/architecture/13-data-architecture.md`).
- **Implement the DB-touching core services** that are stubbed today: `decrementStock` (03 §5), `nextInvoiceNo` (03 §7), `finalizePakka` / `finalizeKacha` (03 §6).
- **Phase 9** integrations (Razorpay webhook + idempotency, R2 image uploads, cron jobs), **Phase 10** CI/CD (GitHub Actions + Dockerised Postgres tests + gitleaks/audit), **Phase 11** seed (owner + RBAC + sample UoM data).

Accounts needed **later** (not for the first run): Upstash, Razorpay (test keys), Cloudflare R2, Resend/MSG91. Template: root `.env.example`.

## Quick reference
| You want to… | Do this |
|--------------|---------|
| See it run | Steps 1–4 |
| Browse the data | `pnpm --filter @hardware/db db:studio` |
| Run the tests | `pnpm --filter @hardware/core test` and `…/auth test` |
| Understand a decision | `docs/architecture/adr/` |
| Know what's left | `SCAFFOLDING.md` + `docs/architecture/11-scaffolding-plan.md` |

## Notes
- The "Prisma engine 403 / checksum" error only happens on restricted networks — it downloads fine on your machine.
- Keep `packages/db/.env` out of git (already in `.gitignore`).
