# ADR-0010: Hosting — free during dev → paid at go-live

**Status:** Accepted · 2026-06-24

## Context
Cost is a primary optimization goal, and the shop earns no revenue while the app is being built. We want **₹0 during development** but a **fast, reliable** runtime once the shop is live — especially for the counter POS, which must feel instant (`../09-nfr.md` NFR-PERF-01/03). Two facts shape the decision: (1) **Vercel's free Hobby plan is non-commercial only**, so a live revenue-earning shop may not run on it; and (2) **free serverless has cold starts**, which make a POS feel sluggish/unreliable (NFR-AVL-03). Nothing in the build (standard Next.js + Postgres, Dockerized) locks us to a vendor.

## Decision
**Host free during development, pay only at go-live.**
- **Dev / staging (₹0):** apps on **Vercel Hobby** (free) + **Neon** free Postgres (scales to zero) + **Upstash** free Redis/QStash. Region: no preference → nearest free region.
- **Go-live (target < ~₹3,000/mo — `../09-nfr.md` NFR-COST-02):** move to a **paid, warm tier** — either **Vercel Pro (~₹2,100/mo)** or a **Mumbai VPS (~₹450–1,000/mo)**, Dockerized. The specific choice is made **at launch**.

## Consequences
**Positive**
- ₹0 development cost (NFR-COST-01) while still using production-grade services.
- A deliberate, documented trigger to leave the free tier — avoids accidentally running a live shop on a non-commercial plan with cold starts.
- Keeping both go-live options open (Vercel Pro **or** Mumbai VPS) preserves leverage on cost, data residency, and ops effort; the Docker image runs on either (NFR-PORT-01).
- Mumbai VPS option keeps **data in India** with **INR billing** and avoids RBI e-mandate friction on international recurring card charges (`../00-overview.md`).

**Negative / tradeoffs**
- **Dev/demo environment is not representative of production latency** — free-tier cold starts mean PERF targets can only be validated on the paid tier (`../09-nfr.md` verification note).
- A **migration step at go-live** is required (env, domain, possibly host) — small, but real, and must be planned.
- Deferring the Vercel-Pro-vs-VPS choice means two candidate runtimes to keep viable until launch (slightly more to reason about).

## Alternatives considered
- **Paid hosting from day one** — rejected: spends money before any revenue with no benefit during the build.
- **Stay on the free Hobby tier at launch** — rejected: non-commercial terms plus cold-start latency make it unsuitable for a live POS (NFR-AVL-03).
- **Commit now to exactly one of Vercel Pro / VPS** — deferred deliberately: real launch constraints (traffic, residency, ops appetite) will decide better than a guess today. Option C (Railway/Render) noted but India-region latency is a concern (`../00-overview.md`).

See also: `ADR-0004-postgresql-on-neon.md`, `../05-infrastructure-architecture.md`, `../09-nfr.md` (NFR-AVL-03, NFR-COST-01/02, NFR-PORT-01).
