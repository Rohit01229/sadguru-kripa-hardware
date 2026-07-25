# Architecture Decision Records (ADRs)

**Status:** Active · 2026-06-24
This folder records the **why** behind the significant, hard-to-reverse decisions for the hardware-store web app (single store, India, GST-registered, turnover < ₹5 cr). Each ADR is immutable once **Accepted**; if a decision changes, we add a new ADR that supersedes the old one rather than editing history.

Context for these decisions lives in the architecture suite — see `../README.md`, `../00-overview.md`, `../01-tech-stack.md`, `../02-solution-architecture.md`, and the quantified `../09-nfr.md`.

## Template
Every ADR follows a consistent MADR-style shape:
**Title** → **Status** → **Context** → **Decision** → **Consequences** (positive + negative/tradeoffs) → **Alternatives considered**.

## Index

| # | Title | Status |
|---|-------|--------|
| [ADR-0001](ADR-0001-modular-monolith.md) | Modular monolith (not microservices) | Accepted |
| [ADR-0002](ADR-0002-turborepo-monorepo.md) | Turborepo monorepo (apps + shared packages) | Accepted |
| [ADR-0003](ADR-0003-nextjs-typescript-fullstack.md) | Next.js (App Router) + TypeScript full-stack | Accepted |
| [ADR-0004](ADR-0004-postgresql-on-neon.md) | PostgreSQL on Neon (pooled connection) | Accepted |
| [ADR-0005](ADR-0005-authjs-self-hosted.md) | Auth.js v5 self-hosted (not managed auth) | Accepted |
| [ADR-0006](ADR-0006-razorpay-payments.md) | Razorpay for payments (hosted checkout + webhooks) | Accepted |
| [ADR-0007](ADR-0007-unit-of-measure-model.md) | Unit-of-measure model (base unit + sale units) | Accepted |
| [ADR-0008](ADR-0008-kacha-zero-trace.md) | Kacha bill = zero trace | Accepted |
| [ADR-0009](ADR-0009-einvoice-deferred.md) | e-Invoice (IRN) deferred (switch-on later) | Accepted |
| [ADR-0010](ADR-0010-hosting-free-then-paid.md) | Hosting: free during dev → paid at go-live | Accepted |
| [ADR-0011](ADR-0011-single-store-owneronly-rbac-extensible.md) | Single store, owner-only login, RBAC-extensible | Accepted |

## Status legend
- **Proposed** — under discussion.
- **Accepted** — decided and in force.
- **Superseded** — replaced by a later ADR (linked).
- **Deprecated** — no longer relevant.
