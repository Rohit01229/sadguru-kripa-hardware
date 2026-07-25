# ADR-0009: e-Invoice (IRN) deferred (switch-on later)

**Status:** Accepted · 2026-06-24

## Context
Under India's GST regime, **e-Invoicing (IRN generation via the IRP, with QR)** is mandatory only above an aggregate-turnover threshold. This shop's turnover is **< ₹5 cr**, which is below the e-Invoicing threshold, so IRN is **not legally required** for it today (revised after review — `../documentation/req_v1/02-feature-proposal.md` Decision 6). Building IRP integration now would add real complexity (IRP onboarding, payload schemas, error handling, QR rendering) for no current legal benefit. However, turnover can grow and the threshold can change, so we must not paint ourselves into a corner.

## Decision
**Defer e-Invoice (IRN) generation.** It is **not** built in v1. Instead:
- **Pakka invoices remain full GST tax invoices** — GSTIN, HSN codes, CGST/SGST/IGST split, place-of-supply rule, GST rounding, and **gapless sequential numbering** (`../09-nfr.md` NFR-REL-03, NFR-SEC-10), plus **GSTR-1 + HSN-summary export** so the accountant can file.
- e-Invoice is designed as a **switch-on module**: when/if turnover crosses the threshold (or the owner opts in), IRN generation can be enabled without reworking the invoice model.
- **e-Way bill** generation (for consignments above ₹50k) is kept as a **nice-to-have**, available for goods movements.

## Consequences
**Positive**
- Avoids significant integration effort and ongoing IRP complexity that has no legal requirement at current turnover — keeps v1 lean and on schedule.
- Pakka invoices are still fully compliant tax invoices and GSTR-1-filable, so the shop's actual obligations are met (NFR-SEC-10).
- Designing IRN as a switch-on module means future enablement is additive, not a rewrite — consistent with the modular monolith (`ADR-0001-modular-monolith.md`).

**Negative / tradeoffs**
- If turnover later crosses the threshold, IRN must be implemented **before** that obligation kicks in — a future work item that must be tracked, not forgotten.
- No IRN/QR on invoices today means no government-validated invoice reference; acceptable because it is not required for this business.
- The invoice data model must be designed with eventual IRN fields in mind (so the switch-on is clean) — a small upfront design constraint, not a build cost.

## Alternatives considered
- **Build full e-Invoicing now** — rejected: substantial effort and a live IRP dependency for zero current legal benefit at < ₹5 cr turnover.
- **Use a third-party GSP/e-invoice SaaS now** — rejected for v1 on cost/complexity; remains a fast option when the switch-on module is enabled.
- **Skip GSTR-1 export too** — rejected: GSTR-1 export is required to actually file GST and is in v1 scope; only IRN is deferred.

See also: `ADR-0008-kacha-zero-trace.md` (the other bill type), `../09-nfr.md` (NFR-SEC-10, NFR-REL-03), `../documentation/req_v1/02-feature-proposal.md` (Module 3 — GST).
