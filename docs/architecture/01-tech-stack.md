# Tech Stack

**Status:** DRAFT · 2026-06-24
The canonical list of languages, frameworks, libraries and services, with the reasoning. Hosting/cost detail lives in `05-infrastructure-architecture.md`; this doc is the "what we build with".

## At a glance
| Concern | Choice | Why (fast dev · secure · low cost · scalable) |
|---------|--------|-----------------------------------------------|
| Language | **TypeScript** | One typed language end-to-end → fewer bugs, shared types between apps |
| Runtime | **Node.js (current LTS)** | Standard, well-supported; pin LTS at scaffold |
| Framework | **Next.js (App Router)** | Storefront + admin + API in one toolchain; SSR for SEO storefront; server actions speed up CRUD |
| UI runtime | **React** | Ecosystem + shadcn/ui components |
| Styling/UI | **Tailwind CSS + shadcn/ui** | Prebuilt accessible components → fast, consistent screens |
| ORM | **Prisma** | Already in repo; typed queries; migrations; parameterized (no SQLi) |
| Database | **PostgreSQL (Neon)** | Reliable, free to start, scales far; Neon scales to zero for low cost |
| Auth | **Auth.js (NextAuth) v5** | Self-hosted, free; email/password; Prisma adapter; RBAC-ready |
| Validation | **Zod** | One schema validates form + API + DB input |
| Payments | **Razorpay** | India standard; UPI + cards; hosted checkout keeps card data off our servers |
| File storage | **Cloudflare R2** | S3-compatible, **no egress fees** → cheap product images |
| Background jobs | **Vercel Cron + Upstash QStash** | Reminders, reservation-expiry, day-end without a always-on worker (free tiers). pg-boss if we later run a VPS |
| Search | **Postgres full-text + `pg_trgm`** | Typeahead over ~5k SKUs without a paid search service |
| Email | **Resend** (or AWS SES) | Cheap transactional email (order/khata notifications) |
| SMS | **MSG91** | India DLT-compliant SMS for reminders/OTP |
| WhatsApp | *(phase 2)* | WhatsApp Business API via MSG91/Gupshup — cost + template approval |
| Errors | **Sentry** (free tier) | Exception tracking across both apps |
| Uptime | **UptimeRobot** | Free external uptime checks + alerts |
| CI/CD | **GitHub + GitHub Actions** | Lint/test/build, Turborepo remote cache, preview + prod deploys |
| Packaging | **Docker** | Portable image → not locked to any host |
| Monorepo | **Turborepo + pnpm workspaces** | Task caching, shared packages, fast installs |

## Notes & rationale
- **Why Next.js full-stack (not a separate API server):** for a solo/small build it halves the moving parts — UI, API route handlers and server actions live together, with shared TypeScript types from `@hardware/db` and `@hardware/core`. We can still extract a standalone API later (see `03-technical-architecture.md`).
- **Why Prisma + Postgres on Neon:** Prisma is already in the repo and gives typed, migration-driven schema. On serverless we use a **pooled connection** (Neon's pooler or Prisma Accelerate) to avoid exhausting DB connections.
- **Why Auth.js over a managed auth (Clerk/Supabase Auth):** zero per-user cost and full control; the tradeoff is we implement verification/reset/2FA ourselves (covered in `07-security-architecture.md`).
- **Why R2 over S3:** same API, but no egress fees — meaningful for image-heavy product pages.
- **Background jobs on serverless:** a persistent queue worker (pg-boss/BullMQ) needs an always-on process, which Vercel doesn't provide. We use **scheduled crons + Upstash QStash** instead; if production later runs on a VPS, pg-boss becomes the simpler option.

## Versioning policy
Pin exact major/minor versions at scaffold time and record them here (Next.js, React, Prisma, Postgres, Auth.js, Tailwind). Renovate/Dependabot proposes upgrades; CI must pass before merge. Target the current stable/LTS of each at project start.

## Not chosen (and why)
- **Microservices / separate backend** — overkill for v1; see `adr/ADR-0001-modular-monolith.md`.
- **Managed search (Algolia/Elastic)** — unnecessary cost at ~5k SKUs; Postgres FTS suffices.
- **NoSQL** — the domain is relational (invoices, ledger, stock movements); Postgres fits.
