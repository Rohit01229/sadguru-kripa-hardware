# System Architecture — v1 (Draft)

**Status:** 🟢 Foundation locked — designing together · 2026-06-24
**Optimising for:** ① fast development ② security ③ low cost ④ scalable later

---

## Guiding principle: modular monolith first
Build **one deployable app** with **clean internal module boundaries** (Inventory · Billing · Ecommerce · Ledger · Auth). Not microservices.

- **Fast dev** — one codebase, one deploy, one DB, shared types. No cross-service plumbing.
- **Low cost** — a single small server runs everything; no per-service hosting bills.
- **Scalable later** — because modules are cleanly separated, the heavy ones (ecommerce, billing) can be peeled into their own services *when traffic demands it*, not before.
- **Security** — one surface to harden, one auth layer, fewer moving parts.

## Recommended stack
| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** | One language front-to-back; type safety = fewer bugs |
| Framework | **Next.js (App Router)** | Storefront + `/admin` + API in one app; fast to build; huge ecosystem; pairs with Prisma |
| ORM + DB | **Prisma + PostgreSQL** | Already in your repo; Postgres is rock-solid, free, scales far |
| UI | **Tailwind + shadcn/ui** | Prebuilt accessible components → fast, consistent UI |
| Auth | **Auth.js (NextAuth)** | Free, self-hosted; email/password customers + owner admin; RBAC |
| Validation | **Zod** | One schema validates client + server + DB inputs |
| Payments | **Razorpay** | India standard; UPI + cards; hosted checkout (no card data on our servers) |
| Images | **Cloudflare R2** | S3-compatible, **no egress fees** → very cheap product-image hosting |
| Background jobs | **Vercel Cron + Upstash QStash** (free) | Serverless has no long-running worker → scheduled crons + a free queue for reminders, reservation-expiry, day-end. *(Switch to pg-boss if we later run a VPS.)* |
| Search | **Postgres full-text + pg_trgm** | Fine for ~5,000 SKUs; no paid search service needed |
| Email / SMS | **Resend or AWS SES** / **MSG91** | Cheap email; MSG91 handles India DLT for SMS. WhatsApp = phase 2 |
| Monitoring | **Sentry** (free tier) + **UptimeRobot** | Error + uptime visibility at no cost |
| CI/CD | **GitHub + Actions**, **Dockerised** | Portable image → can run on any host; no lock-in |

## Hosting options — current pricing (June 2026)
| # | Setup | ~Cost / month | Best for | Watch-outs |
|---|-------|---------------|----------|------------|
| **A** | **Mumbai VPS, Dockerised** (Lightsail / Vultr / DigitalOcean) running app + Postgres + jobs | **₹450–1,000** ($5–12) | Lowest cost, **data stays in India**, INR billing, zero lock-in | You own backups, updates, scaling (vertical first) |
| **B** | **Managed serverless** — Next.js on **Vercel Pro** ($20) + **Neon** Postgres ($5, scales to zero) | **~₹2,100** ($25) | Fastest dev, auto-scale, near-zero ops | Commercial use **requires** Vercel Pro; confirm Mumbai region; some lock-in |
| **C** | **Managed PaaS** — Railway / Render app + managed Postgres | **~₹600–2,100** ($7–25) | Easy deploys, less lock-in than Vercel | India region limited → latency |

Plus, in every option: **Razorpay 2% + GST** per successful transaction (no setup/AMC); **domain ~₹900/yr**; email/SMS billed by usage.
> ⚠️ **RBI e-mandate:** Indian banks block international recurring charges by default. An **INR-billing Indian host** (or a card with international payments enabled) avoids surprise failures — a point for Option A.

## Decision: free now, cheap at launch (chosen 2026-06-24)
Host **free during development**, pay only at go-live.
- **Dev / staging (₹0):** apps on **Vercel Hobby** (free) + **Neon** free Postgres (scales to zero) + **Upstash** free Redis/QStash. Region: no preference → nearest free region.
- **⚠️ Reality check:** Vercel's free Hobby plan is **non-commercial only** — perfect for building and demos, but a live revenue-earning shop must move to **Vercel Pro (~₹2,100/mo)** or a **₹450/mo Mumbai VPS** at launch. Free serverless also has **cold starts**, which is bad for a counter POS that must respond instantly — another reason to take a cheap paid tier at go-live.
- **Go-live (~₹450–2,100/mo):** Vercel Pro **or** Mumbai VPS — decided at launch. Nothing in the build locks us in (standard Next.js + Postgres).
- **Cost timeline:** ₹0 while we build → small monthly cost only when the shop goes live.

## Security model (baseline)
- **TLS everywhere** (Caddy auto-HTTPS on VPS, or platform-managed).
- **Auth.js**: httpOnly secure-cookie sessions, **argon2id** password hashing, email verification, password reset, **login rate-limiting**.
- **RBAC**: owner-admin vs customer; admin area separately gated, optional **2FA** on the owner login.
- **Input validation (Zod)** on every endpoint; **Prisma parameterised queries** (no SQL injection).
- **Payments**: Razorpay **hosted checkout** — card data never touches our servers; **verify webhook signatures**; idempotent order handling.
- **Secrets** in host secret store / env — never in the repo.
- **PII / GSTIN**: least-privilege DB access, **encrypted backups**, India residency.
- **Audit / void log** (from the requirements review) for financial integrity.
- Security headers (CSP), CSRF protection, dependency scanning in CI.

## Scale-later path (when the shop grows)
1. **Vertical scale** the VPS (more CPU/RAM) — covers a lot.
2. Move DB to **managed Postgres** with read replicas; add **Redis** cache.
3. Put the storefront behind a **CDN**; serve images from R2 + CDN (already cheap).
4. Extract the busiest module (ecommerce or billing) into its **own service** behind the same API.
5. Horizontal-scale stateless app containers (Fly.io / Render / K8s) — the Docker image already supports this.

Each step is incremental because the monolith is modular — no big-bang rewrite.

## Decisions locked (2026-06-24)
1. ✅ **Hosting** — free during dev (Vercel Hobby + Neon free); cheap paid tier at go-live (Vercel Pro or ₹450 Mumbai VPS). *(Vercel free = non-commercial; production needs a paid tier.)*
2. ✅ **Database** — PostgreSQL on **Neon** (free now, Launch $5 later); use a **pooled connection** for serverless Prisma (Neon pooler / Prisma Accelerate).
3. ✅ **Auth** — **Auth.js (NextAuth)** self-hosted with the Prisma adapter.
4. ✅ **Data residency** — no preference (pick nearest free region).
5. ✅ **Repo** — **Turborepo monorepo** (apps: admin + storefront; shared packages: db, core, auth, ui, config).

## Monorepo structure (Turborepo)
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
├─ turbo.json
└─ package.json     # workspaces
```
Both apps import `@hardware/db` + `@hardware/core`, so there's **one database and one set of business rules** — the modular-monolith benefit, even with two deployables.

## Sources (pricing, June 2026)
- [Vercel pricing](https://vercel.com/pricing) · [Hobby plan (non-commercial)](https://vercel.com/docs/plans/hobby)
- [Neon pricing 2026](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/) · [Supabase pricing](https://supabase.com/pricing)
- [Razorpay charges 2026](https://www.softwaresuggest.com/blog/razorpay-payment-gateway-charges/) · [Razorpay UPI charges](https://razorpay.com/learn/upi-transaction-charges/)
- [Amazon Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) · [Cheapest VPS India 2026 (INR)](https://www.techplained.com/cheapest-vps-india)
