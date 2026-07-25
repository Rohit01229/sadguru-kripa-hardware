# ADR-0011: Single store, owner-only login, RBAC-extensible

**Status:** Accepted · 2026-06-24

## Context
v1 is for **one shop with one stock pool**, run by an owner. The management + billing side (stock, kacha/pakka billing, ledger, reports) runs under a **single owner/admin login** — there are no separate cashier, stock-manager, or accountant accounts yet (locked in `../documentation/req_v1/02-feature-proposal.md` Decision 9). The storefront, by contrast, has its **own customer accounts**, separate from the admin login. We must not over-build multi-user RBAC now, but the owner expects to add staff roles later **without a schema rewrite**.

## Decision
Ship a **single owner/admin login** for the admin app in v1, but **model RBAC from the start as role → permissions** so additional roles (cashier, stock-manager, accountant) can be introduced **without schema churn**:
- Identities are stored in our own DB via Auth.js (`ADR-0005-authjs-self-hosted.md`).
- The data model includes **roles** and **permissions** (and a role↔permission mapping) even though only one role (owner/admin) exists today; permission checks are written at sensitive operations from day one.
- **Customer accounts** for the storefront are a **separate** identity space from admin users.
- Detailed role/permission matrix and enforcement live in `../10-rbac.md`.

## Consequences
**Positive**
- Minimal v1 surface (one admin login) — simplest to build and secure now.
- Because permission checks and the role/permission tables exist from the start, adding a cashier or accountant later is **configuration + new role rows**, not a migration of every protected operation (`../09-nfr.md` NFR-SCAL-02).
- Clean separation of admin vs customer identities reduces blast radius and keeps the admin area independently gateable (with optional 2FA on the owner login — NFR-SEC-04).

**Negative / tradeoffs**
- Some **upfront modeling cost**: building the role/permission structure and writing permission checks before any second role exists is effort spent for future benefit.
- Risk of **YAGNI** if multi-user is never needed — judged worthwhile because retrofitting access control across a financial app later is painful and error-prone.
- Until more roles ship, all admin actions are attributable only to "the owner," so the audit log (NFR-REL-09) can't distinguish staff — acceptable at single-user scale.

## Alternatives considered
- **Hard-code a single owner with no RBAC model** — rejected: cheapest now, but adding staff later would mean retrofitting access control throughout the billing/stock code — exactly the schema churn we want to avoid.
- **Full multi-role RBAC + admin UI for user management in v1** — rejected: over-engineering for a one-owner shop; defers more valuable v1 work.
- **One shared identity space for admin + customers** — rejected: conflates very different audiences and weakens admin-area isolation.

See also: `ADR-0005-authjs-self-hosted.md`, `../10-rbac.md`, `../07-security-architecture.md`, `../09-nfr.md` (NFR-SCAL-02, NFR-SEC-04).
