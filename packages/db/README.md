# @hardware/db — Database (hosted Postgres)

Owns the Prisma schema + client. Configured for an **online hosted Postgres** (Neon, Supabase, Railway, Aiven, RDS…). The app reads a **pooled** connection; migrations use a **direct** connection.

## 1. Environment
Create `packages/db/.env` (git-ignored):
```env
DATABASE_URL="<pooled connection string>"   # app runtime
DIRECT_URL="<direct connection string>"      # migrations only
```

Provider cheat-sheet:
| Provider | `DATABASE_URL` (pooled) | `DIRECT_URL` (direct) |
|----------|--------------------------|------------------------|
| **Neon** | `...-pooler.<region>.aws.neon.tech` host, `?sslmode=require` | non-pooler host, `?sslmode=require` |
| **Supabase** | port **6543** (pgbouncer), `?pgbouncer=true` | port **5432** |
| **Railway / Aiven / RDS** | the single provided URL | same URL |

> If there's no separate pooler, set **both** variables to the same URL.

## 2. Generate + migrate
```bash
pnpm --filter @hardware/db db:generate      # generate the Prisma client
pnpm --filter @hardware/db db:migrate:dev   # create & apply the first migration (dev)
pnpm --filter @hardware/db db:migrate       # apply migrations (prod / CI: migrate deploy)
pnpm --filter @hardware/db db:studio        # browse data
```
After `db:generate`, `pnpm --filter @hardware/db typecheck` passes.

## 3. Pooling & serverless
The standard pooled connection works on Vercel/serverless. To cut cold-start latency later you can switch to the **Neon serverless driver** (`@prisma/adapter-neon` + the `driverAdapters` preview) — optional, not needed for v1.

## 4. Security (07 §3)
- **Least privilege:** the app should connect as a role that can do DML but **not** destructive DDL; migrations run under a separate, privileged role. On Neon/Supabase create a restricted role for `DATABASE_URL`; keep migrations on the owner role.
- The client is a **singleton** (`src/client.ts`). Only `@hardware/core` imports it — never the apps directly (03 §1).

## 5. Schema
Foundation subset is live in `prisma/schema.prisma`; the full target model (all modules) is documented in [`../../docs/architecture/13-data-architecture.md`](../../docs/architecture/13-data-architecture.md). Grow the schema per that doc as features land.
