# Hardware Store App — Requirements v1

**Status:** 🟢 Scope locked + review applied (v1 tightened) — ready to finalize v1 baseline
**Last updated:** 2026-06-24

This folder holds the requirements work for the hardware-store application. Documents here stay in DRAFT until we agree on scope, then we lock them as the v1 baseline.

## The app in one line
A single system for a hardware store (paint, electrical, hardware/fasteners, plumbing, tools, etc.) with three parts:

1. **Stock Management** (owner/staff) — add and track stock that sells in different units/quantities.
2. **Ecommerce** (customers) — browse and order online.
3. **Admin Billing** (counter) — POS billing with two templates: **kacha bill** (rough/estimate, history *not* saved) and **pakka bill** (tax invoice, history saved).

## Documents
| File | Purpose |
|------|---------|
| `01-competitor-research.md` | What comparable apps (Vyapar, myBillBook, Marg, GoFrugal, etc.) already do |
| `02-feature-proposal.md` | Proposed feature set per module + locked decisions (review changes folded in) |
| `03-review-and-gaps.md` | Critical review: ratings, prioritized gaps (P0/P1/P2), re-tiering |

## Decisions locked — Round 1 (2026-06-24)
1. ✅ **GST-registered** → pakka bill = full tax invoice (GSTIN, HSN, CGST/SGST split, gapless numbering).
2. ✅ Ecommerce audience = **Both B2C + B2B** (retail cart + wholesale quote/credit).
3. ✅ Kacha bill = **zero trace** (revised in review) — no bill/value/cash/customer saved; stock still decrements (shows as an unattributed stock-out; cash won't auto-reconcile).
4. ✅ Platform = **responsive web app** (counter PC + phone), online, Prisma/Node + SQL DB.

## Decisions locked — Round 2 (2026-06-24)
5. ✅ B2B pricing = **universal bulk/quantity discounts** (visible to all; no separate wholesale logins). GSTIN captured at checkout.
6. ⚠️ **e-Invoice (IRN) = deferred** (revised in review — turnover < ₹5 cr, not legally required); **e-Way bill** kept for goods movement > ₹50k.
7. ✅ **Credit / khata = yes** — customer credit ledger with dues aging + reminders.
8. ✅ Catalog ≈ **medium (500–5,000 SKUs)** with CSV/Excel bulk import.

## Decisions locked — Round 3 (2026-06-24)
9. ✅ **Single store, owner-only admin** login (roles can be added later); separate customer accounts for ecommerce.
10. ✅ Online payments = **both** gateway (UPI/cards) and pay-at-store / on-delivery.

## Module refinement — Round 4 (2026-06-24)
- **Stock:** multiple sale units per product; batch + optional expiry for applicable items; barcode (scan branded / search loose); suppliers + GRN (POs later); CSV/Excel import.
- **Ecommerce:** email/password accounts; local delivery + store pickup; order **reserves stock → pakka invoice on dispatch**; flat delivery fee, free above a threshold.
- **Billing:** thermal + A4/A5 (selectable); kacha = no tax, **convertible to pakka**; invoice shows logo/GSTIN/address + bank details + T&C/signature (no UPI QR); payments cash/UPI/card + **credit khata with part-payment**.

## Review pass — Round 5 (2026-06-24)
Rated **dev 6.5/10 · shopkeeper 7.5/10 · overall ~7/10** (see `03-review-and-gaps.md`). Changes folded into the proposal:
- **e-Invoice (IRN) → deferred** (turnover < ₹5 cr) — leaner v1.
- **Kacha = zero trace** (your call) — cash won't auto-reconcile; accepted.
- **Promoted to must-have:** GSTR-1/HSN export, manual rate override at billing, automated backup, audit/void log, place-of-supply (IGST) rule, GST rounding, invoice cancel/credit-note flow, atomic stock reservation + timeout.
- **Added as nice-to-have:** supplier dues/payables, saved quotation/estimate, delivery challan.

## Next step
Proposal is now a tightened v1. Pending your go-ahead, next deliverables are a **finalized v1 baseline spec** + a **data-model sketch** (unit-of-measure model first).
