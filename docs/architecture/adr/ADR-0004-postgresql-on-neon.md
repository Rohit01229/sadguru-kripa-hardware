# ADR-0004: PostgreSQL on Neon (pooled connection)

**Status:** Accepted · 2026-06-24

## Context
The domain is strongly relational — invoices, line items, stock movements, the khata ledger, suppliers, and GST tax records all have foreign-key relationships and need transactional integrity (no overselling, gapless numbering, ledger invariants — `../09-nfr.md` NFR-REL-01/03/06). Prisma is already in the repo. The app runs on serverless Next.js (`ADR-0003-nextjs-typescript-fullstack.md`), where many short-lived function instances can otherwise exhaust a database's connection limit. Cost must be ₹0 during development.

## Decision
Use **PostgreSQL hosted on Neon**, accessed via **Prisma**. On serverless we connect through a **pooled connection** (Neon's connection pooler, or Prisma Accelerate) — pooling is **mandatory**, not optional (`../09-nfr.md` NFR-SCAL-05). Neon's free tier (scales to zero) covers development; the paid Launch tier (~$5/mo) is the go-live baseline.

## Consequences
**Positive**
- Postgres gives ACID transactions that underpin the atomic stock decrement, gapless invoice numbering, and ledger correctness — the integrity backbone.
- Neon free tier = ₹0 dev cost and scales to zero when idle (NFR-COST-01/08); Launch tier is cheap at go-live.
- Prisma provides typed, migration-driven schema and parameterized queries (no SQL injection — NFR-SEC-05/REL-08).
- Postgres full-text search + `pg_trgm` handle typeahead over ≤5k SKUs with no paid search service (NFR-COST-05, NFR-PERF-02).
- Standard Postgres = highly portable; restorable to any Postgres host (NFR-PORT-03).
- Supports PITR for the ≤1h RPO / ≤2h RTO durability targets (NFR-DUR-01/02).

**Negative / tradeoffs**
- Serverless + Postgres requires the pooling discipline above; forgetting it risks connection exhaustion under load.
- Neon's scale-to-zero can add a small DB cold-start on the first query after idle — minor, and the POS paid tier keeps the app warm.
- Some reliance on a managed provider's pooler/Accelerate; mitigated because the underlying engine is portable Postgres.

## Alternatives considered
- **MySQL** — also relational and supported by Prisma; Postgres preferred for richer types, robust FTS + `pg_trgm`, and PITR maturity. (`../01-tech-stack.md` listed Postgres/MySQL as options; Postgres chosen.)
- **Supabase Postgres** — viable managed Postgres, but we chose Neon for scale-to-zero economics and a clean fit; auth is handled separately by Auth.js (`ADR-0005-authjs-self-hosted.md`).
- **A NoSQL store (MongoDB/etc.)** — rejected: the invoice/ledger/stock domain is inherently relational; NoSQL would push integrity logic into the app.
- **Self-managed Postgres on the VPS from day one** — viable at go-live (and still possible via Docker), but adds ops during dev; Neon free is simpler now.

See also: `ADR-0001-modular-monolith.md`, `ADR-0010-hosting-free-then-paid.md`, `../09-nfr.md` (NFR-REL, NFR-DUR, NFR-SCAL-05).
