# ADR-0008: Kacha bill = zero trace

**Status:** Accepted · 2026-06-24

## Context
Hardware retail in India routinely uses two bill types: a **kacha bill** (a rough, no-tax estimate handed to the customer) and a **pakka bill** (a full GST tax invoice). The owner has explicitly decided (locked in `../documentation/req_v1/02-feature-proposal.md` Decision 3) that a kacha sale must leave **no financial footprint** in the system — no saved bill, no value, no cash record, no customer, no tax record. Stock, however, physically leaves the shop, so the inventory count must still be correct.

## Decision
A **kacha bill is zero-trace**. When a kacha bill is finalized, the **only** thing persisted is the **stock decrement** (in base units, per `ADR-0007-unit-of-measure-model.md`). Nothing else — no invoice row, no amount, no payment, no customer, no GST/tax line — is saved. A kacha bill **can be converted to a pakka bill before finalize**; conversion is the moment the sale becomes a saved, taxed, permanently retained invoice (`ADR-0009-einvoice-deferred.md` for GST context; `../09-nfr.md` NFR-REL-05). The kacha stock-out therefore appears as an **unattributed stock-out / adjustment**, indistinguishable from shrinkage.

## Consequences
**Positive**
- Exactly matches the owner's explicit, locked requirement.
- Keeps stock counts accurate despite no financial record — the one footprint (the decrement) preserves inventory integrity (NFR-REL-07).
- The kacha→pakka conversion gives a clean, single point where a sale becomes a compliant, retained tax invoice — aligning the saved/not-saved split with estimate-vs-invoice.
- Simpler kacha finalize path (no invoice/tax/ledger writes) — lower latency (`../09-nfr.md` NFR-PERF-04).

**Negative / tradeoffs (explicitly accepted by the owner)**
- **Cash will not auto-reconcile**: with no value/cash record for kacha, the drawer can't be balanced by the system for those sales — manual reconciliation accepted.
- **No audit trail for kacha**: there is no bill/customer/amount to inspect, so kacha activity is invisible to reports and the audit log (NFR-REL-09 covers only saved/financial actions).
- **Kacha stock-outs read like shrinkage**: an unattributed decrement cannot be told apart from damage/theft/count error — accepted.
- This is a deliberate business choice with financial-control implications; it is documented here so the tradeoff is never mistaken for a bug.

## Alternatives considered
- **Save kacha bills internally (hidden from GST), drop on demand** — rejected: contradicts the owner's "zero trace" requirement and would create a record the owner explicitly does not want.
- **Don't decrement stock for kacha** — rejected: would break inventory accuracy, the one thing that must stay correct.
- **Force every sale to be a pakka invoice** — rejected: removes the kacha workflow the shop relies on.

See also: `ADR-0007-unit-of-measure-model.md`, `ADR-0009-einvoice-deferred.md`, `../03-technical-architecture.md`, `../09-nfr.md` (NFR-REL-05/07, NFR-PERF-04).
