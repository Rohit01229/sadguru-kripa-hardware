# Hardware Store App — Architecture

**Status:** 🟢 First full draft complete (for review) · 2026-06-24
Architecture documentation for the hardware-store system. Product requirements live in `../documentation/req_v1/` (start with `02-feature-proposal.md` and `03-review-and-gaps.md`).

## How to read
`00-overview` is the executive summary. Then, roughly in order:
tech-stack → solution → technical → API → infrastructure → network → security → observability → NFRs → RBAC, with decision records in `adr/`.

## Document suite
| # | File | Purpose |
|---|------|---------|
| 00 | `00-overview.md` | One-page architecture summary (stack, hosting, cost, security, scale path) |
| 01 | `01-tech-stack.md` | Languages, frameworks, libraries, services + rationale and versions |
| 02 | `02-solution-architecture.md` | System context, modules, major data flows |
| 03 | `03-technical-architecture.md` | Monorepo internals, module boundaries, key patterns (UoM, stock txn, kacha, numbering) |
| 04 | `04-api-design.md` | API style, conventions, endpoint catalog, webhooks |
| 05 | `05-infrastructure-architecture.md` | Environments, hosting (free→paid), CI/CD, backups, storage |
| 06 | `06-network-architecture.md` | Domains, DNS, TLS, traffic flow, CORS, rate limiting |
| 07 | `07-security-architecture.md` | AuthN/Z, data protection, payment security, OWASP, audit |
| 08 | `08-observability-architecture.md` | Logging, error tracking, metrics, uptime, alerting |
| 09 | `09-nfr.md` | Quantified non-functional requirements |
| 10 | `10-rbac.md` | Roles, permission matrix, enforcement |
| 11 | `11-scaffolding-plan.md` | Phased build order: repo → packages → apps → integrations → CI/CD → DX |
| 12 | `12-scaffolding-plan-review.md` | Critique of the scaffolding plan vs the arch docs: gaps, fixes, rating |
| 13 | `13-data-architecture.md` | Full Prisma schema: all models, enums, indexes, gapless numbering |
| — | `adr/` | Architecture Decision Records (one per key decision) |

## Locked decisions — quick reference
**Product:** single hardware store, India, GST-registered (turnover < ₹5 cr). Three parts — Stock, Ecommerce (B2C+B2B), Admin Billing (kacha/pakka). Core complexity = **multi-unit-of-measure**. **Kacha = zero trace** (stock drops, nothing else saved). **Pakka = full GST tax invoice**, gapless numbering. **e-Invoice/IRN deferred**. **Khata** credit ledger. Quantity-break pricing for all.

**Architecture:** **modular monolith** in a **Turborepo** (apps `admin` + `storefront`; shared `db`/`core`/`auth`/`ui`/`config`). **Next.js + TypeScript + Prisma + PostgreSQL (Neon)**, **Auth.js**, **Razorpay**, **Cloudflare R2**. **Free hosting during dev → cheap paid tier at go-live** (Vercel Pro or Mumbai VPS).

## Conventions
- Markdown, prose-first, with tables/Mermaid where they help.
- Everything is grounded in the locked decisions above; genuinely open points are marked **TBD**.
- Docs cross-reference each other rather than duplicating content.
