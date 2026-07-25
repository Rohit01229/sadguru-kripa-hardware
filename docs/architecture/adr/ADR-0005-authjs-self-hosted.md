# ADR-0005: Auth.js v5 self-hosted (not managed auth)

**Status:** Accepted · 2026-06-24

## Context
The system has two distinct identity surfaces: a **single owner/admin login** for management + billing today (with RBAC modeled so cashier/stock-manager/accountant roles can be added later — `ADR-0011-single-store-owneronly-rbac-extensible.md`), and **separate customer accounts** for the storefront (register/login to order). Cost is a primary goal: managed auth providers (Clerk, Supabase Auth) typically bill per monthly active user, which would grow with the customer base for little benefit at our scale. We also want full control over the login UX and session behavior, and we already run Prisma + Postgres (`ADR-0004-postgresql-on-neon.md`).

## Decision
Use **Auth.js (NextAuth) v5, self-hosted**, with the **Prisma adapter** and an **email/password** credentials provider. Sessions use httpOnly + Secure + SameSite cookies; passwords are hashed with **argon2id**; logins are **rate-limited**; email verification + password reset are implemented; **2FA** is optional on the owner login (`../09-nfr.md` NFR-SEC-02/03/04). The same auth package (`@hardware/auth`) is shared by both apps.

## Consequences
**Positive**
- **Zero per-user cost** — no per-MAU/per-seat fee, however many customer accounts register (NFR-COST-03).
- Full control over login flows, session lifetime, and RBAC modeling — fits the owner-now / roles-later design.
- Identities live in **our own Postgres** alongside customers, orders, and ledgers — no external user store to reconcile, and easy data export (NFR-DUR-05).
- No third-party auth dependency in the critical path.

**Negative / tradeoffs**
- **We own the security-sensitive surface**: email verification, password reset, rate limiting, and 2FA are ours to implement and maintain correctly (detailed in `../07-security-architecture.md`). This is the explicit tradeoff vs a managed provider.
- More upfront work than dropping in a hosted widget.
- We carry responsibility for credential-handling best practices and timely patching (NFR-SEC-12).

## Alternatives considered
- **Clerk** — excellent DX and prebuilt flows, but per-MAU pricing scales with customers and adds a vendor dependency; rejected on cost + control.
- **Supabase Auth** — capable and has a free tier, but couples us more to Supabase's platform and still a managed dependency for a core surface; rejected in favor of self-hosting where our data already lives.
- **Roll-our-own auth from scratch** — rejected: needlessly risky; Auth.js gives a maintained, well-trodden foundation while keeping control.

See also: `ADR-0011-single-store-owneronly-rbac-extensible.md`, `../07-security-architecture.md`, `../09-nfr.md` (NFR-SEC).
