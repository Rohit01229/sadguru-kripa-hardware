# Critical Review — Gaps & Improvements

**Status:** DRAFT · 2026-06-24
A deep pass over `02-feature-proposal.md` from two seats: the **developer** who has to build it and the **shopkeeper** who has to run their shop on it.

## Ratings

| Seat | Score | One-line verdict |
|------|-------|------------------|
| 👨‍💻 Developer | **6.5 / 10** | Clear, well-tiered scope — but the hardest 20% (GST compliance + data integrity) is under-specified, so it's a strong *discussion draft*, not yet *build-ready*. |
| 🏪 Shopkeeper | **7.5 / 10** | Nails the make-or-break needs (multi-unit selling, kacha/pakka, khata, GST). A few daily-counter realities are missing that would bite in week one. |
| **Overall** | **~7 / 10** | Right bones. Needs one focused pass on compliance, data-integrity, and a handful of everyday workflows to reach 9. |

## What's genuinely strong
- **Unit-of-measure is treated as the core risk** and modelled correctly (base unit + multiple sale units + price-per-sale-unit). This is the thing most clones get wrong.
- **Single source of truth** for stock across billing + ecommerce.
- **Kacha = stock movement without a saved bill** is the right instinct for keeping inventory honest.
- **Clear M/N/F tiering** makes scope easy to cut.

---

## P0 — Critical (fix before/at v1; these break things)

**1. Cash won't reconcile because kacha isn't saved.** This is the biggest practical hole. If a kacha sale drops stock but stores *no value*, then at day-end: (a) the cash drawer holds kacha cash the system can't explain; (b) stock shows "gone" with no matching sale → it reads as **shrinkage/theft** in reports; (c) a customer returning a kacha-bought item has no record to return against.
→ *Fix:* even if individual kacha bills aren't retained, capture a **minimal daily aggregate** (kacha count + total value + cash collected) and **tag kacha stock movements** so reports separate "kacha sale" from real shrinkage. Preserves "no kacha history" while keeping the shop operable. **Needs your decision.**

**2. e-Invoice (IRN) is narrower and heavier than the doc assumes.** e-Invoicing is mandatory only **above the turnover threshold (₹5 cr AATO)** and only for **B2B/exports — never B2C**. A mostly-B2C counter shop may not legally need IRN at all. Full GSP/IRP integration (auth, generate, cancel-within-24h, QR, retries, IRP downtime) is a large, high-risk v1 chunk.
→ *Fix:* confirm actual turnover. If below threshold, drop IRN to [F] and **save serious v1 effort**; keep e-Way bill only where goods movement needs it. **Needs your decision.**

**3. No GST return / filing data.** A GST-registered shop files **GSTR-1 + GSTR-3B** monthly. The system stores invoices but offers no **GSTR-1 / HSN-summary / B2B-vs-B2C export**. Without it the owner's accountant can't file *from this system* — a glaring gap for a "GST billing" product.
→ *Fix:* add **GSTR-1 + HSN summary export** as [M] (or strong [N]).

**4. Stock-reservation concurrency + expiry undefined.** Web orders reserve stock while the counter also deducts from the same pool. Without an **atomic decrement**, a **reservation timeout** (release abandoned carts), and a **negative-stock policy**, you get overselling and drift.
→ *Fix:* specify reservation TTL, atomic stock ops, and block-vs-allow-negative behaviour.

**5. Place-of-supply / IGST rule is missing.** Counter sales are intra-state (CGST/SGST); an ecommerce delivery to another state is inter-state → **IGST**. The doc lists IGST but never says *when* it applies.
→ *Fix:* determine tax type from **delivery state vs shop state**.

---

## P1 — Important (daily-use or compliance pain)

**6. No price override at the counter.** Hardware shopkeepers **bargain** constantly. Fixed catalog price + quantity slabs isn't enough — the cashier needs to **edit the rate on a line** (ideally within a floor). Promote a manual rate override to [M].

**7. Supplier dues / payables not tracked.** Receivables (khata) are covered; money owed **to suppliers** isn't. The owner can't see "whom do I owe how much". Add basic purchase-bill + **supplier outstanding** ([N]→[M]).

**8. "Saved estimate/quotation" ≠ kacha.** A contractor wants a written estimate to **take away and return with later** — but kacha "isn't saved", so it can't be retrieved. A retrievable **quotation** (with validity, convertible to invoice) is a separate artifact the requirement conflated with kacha. Add as [N].

**9. No delivery challan.** Building-materials shops routinely **send goods to a site and bill later**, or move stock needing an e-way bill before invoicing. A **challan** doc (and challan→invoice link) is a common need — currently absent.

**10. Returns/refunds are half-defined.** Credit notes vs pakka are [M] (good), but **partial returns**, **refund method** (cash / UPI / adjust-against-khata / gateway refund for online), restocking the correct base-unit qty, and **credit-note e-invoice/e-way** handling are all unspecified. Returns on kacha (no record) undefined.

**11. Backup + audit log should be [M], not [N].** This holds **statutory tax records** (GST retention ≈ 6 years). Automated backup/export and a **void/edit audit trail** (even single-user) are integrity must-haves, not nice-to-haves.

**12. WhatsApp/SMS aren't "just turn on".** WhatsApp needs the **Business API** (paid, template pre-approval); SMS needs **DLT-registered templates** in India. Both carry cost + lead time. Budget for it; keep **email** as the easy fallback.

**13. Online-only billing is an operational risk.** Web app + internet-dependent means **if the connection/server is down, the shop can't bill**. Decide consciously: accept it, or add a **degraded offline mode** (queue + sync). e-Invoice also depends on IRP uptime.

**14. Tax rounding & computation rules unstated.** GST **round-to-rupee** on totals, per-line vs per-invoice rounding, **discount-before-tax**, MRP-inclusive back-calculation. Small errors here cause invoice mismatches and reconciliation headaches.

**15. Invoice cancel/amend flow missing.** "Gapless numbering" means you **can't delete** an invoice — you cancel (within e-invoice 24h) or issue a credit note. No cancel/amend workflow is described.

---

## P2 — Smaller improvements
- **UoM edge cases:** piece↔weight items (nails by piece *and* kg) need a weight-per-piece; wire-coil "≈90 m" actual-length variance; define decimal-quantity precision/rounding.
- **Customer-specific rates** for regulars (currently [F]) — many khata customers expect "their rate"; consider [N].
- **Rate-check / price-enquiry mode** — look up a price without starting a bill (counter staff do this all day).
- **GSTIN validation** (format/checksum) at capture; **HSN→rate auto-lookup**.
- **Brand scheme discounts** (paint companies run schemes) — [F].
- **Warranty/serial capture** for select electrical goods — optional.
- **Shelf-label / rate-tag printing.**
- **Security:** email verification, password reset, rate-limiting; optional **2FA** on the single admin login; multi-tab/session safety (owner on phone + PC at once).

---

## Suggested re-tiering (summary)
| Item | Now | Suggest | Why |
|------|-----|---------|-----|
| GSTR-1 / HSN export | — | **[M]** | Can't file GST without it |
| Kacha daily aggregate + tagged movement | — | **[M]** | Cash + stock reconciliation |
| Manual rate override at billing | — | **[M]** | Bargaining is normal |
| Backup / export | [N] | **[M]** | Statutory records |
| Audit / void log | [N] | **[M]** | Financial integrity |
| Supplier dues / payables | [F] | **[N]/[M]** | Half the money picture |
| Saved quotation/estimate | — | **[N]** | Contractor workflow |
| Delivery challan | — | **[N]** | Goods-to-site billing |
| e-Invoice (IRN) | [M] | **[M] only if turnover ≥ ₹5 cr, else [F]** | Often not legally required |

## Two questions that change scope the most
1. **Turnover** — are you at/above ₹5 cr AATO? (Decides whether e-Invoice is v1 or [F] — a big effort swing.)
2. **Kacha cash** — OK to keep a *minimal daily kacha aggregate* (no item history) so cash + stock reconcile, or must kacha leave **zero** trace?
