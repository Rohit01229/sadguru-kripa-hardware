# ADR-0001: Modular monolith (not microservices)

**Status:** Accepted · 2026-06-24

## Context
The product is a web app for **one** hardware store in India (GST-registered, turnover < ₹5 cr) with three parts — Stock/Inventory, Ecommerce (B2C + B2B), and Admin Billing (kacha/pakka). The build is solo/small-team, optimizing for, in order: ① fast development ② security ③ low cost ④ scalable later (see `../00-overview.md`).

The central technical risk is **shared inventory consistency**: POS billing and ecommerce orders draw from one stock pool and must never oversell (`../09-nfr.md` NFR-REL-01). Pakka invoices need gapless numbering; the khata ledger and stock movements are tightly relational. Splitting these into separate services this early would mean distributed transactions, cross-service plumbing, and per-service hosting bills — cost and complexity the business does not need yet.

## Decision
Build a **modular monolith**: a single logical system with **clean internal module boundaries** (Inventory · Billing · Ecommerce · Ledger · Auth · Pricing/UoM), backed by **one database** and **one set of business rules**. Business logic concentrates in a shared `packages/core` so it cannot drift, while UI/delivery stays thin. We explicitly do **not** adopt microservices for v1.

(Note: physically we ship two Next.js apps — `admin` + `storefront` — but they share `@hardware/db` and `@hardware/core`, so this remains one modular system, not a distributed one. See `ADR-0002-turborepo-monorepo.md`.)

## Consequences
**Positive**
- Fastest path to ship: one codebase, one deploy target, shared types, no inter-service contracts.
- Cheapest to run: a single small runtime/DB serves everything — supports the < ~₹3,000/mo prod target (`../09-nfr.md` NFR-COST-02).
- Stronger consistency: stock decrement, numbering, and ledger postings happen in **local DB transactions**, not sagas — directly enabling no-oversell + gapless numbering guarantees.
- Smaller security surface: one auth layer, one hardening target.
- Scalable later **without a rewrite**: clean boundaries let the busiest module (ecommerce or billing) be peeled into its own service when traffic actually demands it.

**Negative / tradeoffs**
- A single deploy means a bad change can affect all modules at once — mitigated by CI gates, typing, and module isolation (`../09-nfr.md` NFR-MNT-04/05).
- Modules can only scale together until one is extracted; fine at single-store scale, a future constraint.
- Discipline required: boundaries are convention-enforced, not network-enforced — they can erode without review vigilance.

## Alternatives considered
- **Microservices from day one** — rejected: distributed transactions for stock/numbering, multiple deploys, and per-service hosting cost are unjustified for one store; violates the cost and fast-dev goals.
- **Two fully separate apps with separate databases** — rejected: would split the single source of truth for inventory and invite overselling and data drift.
- **Monolith with no module boundaries** — rejected: would make the future extract-a-service path a painful rewrite; the modular structure keeps that path cheap.

See also: `../09-nfr.md` (NFR-SCAL-06 headroom strategy), `ADR-0003-nextjs-typescript-fullstack.md`.
