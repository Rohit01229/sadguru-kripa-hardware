# Feature Proposal (for discussion)

**Status:** DRAFT · 2026-06-24
Legend: **[M]** must-have for v1 · **[N]** nice-to-have · **[F]** future/phase-2

This is a menu to react to, not a final spec. Cut, add, or re-tier anything.

---

## Decisions — Round 1 (LOCKED 2026-06-24)

1. ✅ **GST-registered.** "Pakka bill" = a full **tax invoice**: GSTIN, HSN codes, CGST/SGST (or IGST) split, tax-inclusive/exclusive handling, and **gapless sequential numbering**.
2. ✅ **Ecommerce = Both B2C + B2B.** Retail cart + checkout AND wholesale flows (RFQ/quote, tiered/bulk pricing, customer-specific pricing, GSTIN capture).
3. ✅ **Kacha bill = zero trace** (confirmed in review). A kacha sale keeps **no bill, value, cash, or customer record**. Stock still has to come down, so the *only* footprint is the **stock decrement itself**, which shows as an **unattributed stock-out / adjustment** — it can't be told apart from shrinkage, and kacha cash won't auto-reconcile. Accepted tradeoff.
4. ✅ **Platform = responsive web app** for counter PC + phone. Online (needs internet). Stack: Prisma + Node/TypeScript + PostgreSQL/MySQL; shared API behind a web admin and a web storefront.

## Decisions — Round 2 (LOCKED 2026-06-24)

5. ✅ **B2B pricing = universal bulk/quantity discounts.** Quantity-break pricing (buy more → cheaper per unit) is visible to **all** customers — no separate wholesale logins or approval flow. RFQ/quote becomes optional. GSTIN is still captured at checkout for buyers who need a tax invoice.
6. ⚠️ **e-Invoice (IRN) = NOT in v1** (revised after review — turnover < ₹5 cr, so IRN isn't legally required; deferred to a later phase as a switch-on module). **e-Way bill** stays available for goods movements above ₹50k. Pakka invoices remain full GST tax invoices.
7. ✅ **Credit / khata = yes.** Need a customer credit ledger: outstanding balances, dues aging, and payment reminders (WhatsApp/SMS).
8. ✅ **Catalog ≈ medium (500–5,000 SKUs).** Include a bulk-import (CSV/Excel) path; pay attention to search and pagination, but no extreme-scale tuning needed.

## Decisions — Round 3 (LOCKED 2026-06-24)

9. ✅ **Single store, owner-only admin.** One shop / one stock pool. The management + billing side runs under a **single owner/admin login** — no separate cashier or stock-manager roles in v1 (build so roles *can* be added later). Ecommerce still has its own **customer accounts**, separate from the admin login.
10. ✅ **Online payments = both.** Ecommerce supports an **online gateway** (UPI/cards, e.g., Razorpay) **and** pay-at-store / pay-on-delivery.

**→ All scoping decisions are locked. This proposal is ready to become the v1 baseline.**

---

## Module 1 — Stock / Inventory Management

**Catalog**
- [M] Products grouped by category/sub-category (Paint, Electrical, Fasteners/Hardware, Plumbing, Tools, Adhesives…).
- [M] Product attributes: name, brand, SKU/code, HSN, image, description.
- [M] **Multi-unit of measure (confirmed):** each product has one **base unit** (stock held here) + **multiple sale units** with conversion factors (metre/coil, litre/bucket/can, kg/bag, piece/box). Cashier picks the sale unit at billing; every unit deducts the same base pool.
- [M] **Price set per sale unit** (a coil isn't forced to 90× the per-metre price; this also drives bulk pricing). Cost tracked per base unit for margin.
- [M] **Decimal quantities** for measured units (length/weight/volume); piece-type units stay whole.
- [M] **Batch + optional expiry** for applicable items (paints, adhesives, sealants), with near-expiry alerts; includes MRP-wise lots.
- [N] Variants (size/colour/gauge) under one parent item (e.g., wire 1.0/1.5/2.5 sq mm; paint shades).

**Stock movements**
- [M] **Supplier records + goods-received (GRN)** stock-in; auto-increase stock.
- [M] Sales auto-deduct (from billing — including kacha bills).
- [M] Manual stock adjustment + reason (damage, wastage, count correction); opening-stock entry.
- [M] Sales returns / purchase returns.
- [N] Bulk→retail repacking (open a box, convert to singles).
- [N] **Supplier purchase bills + dues/payables** — how much you owe whom. *(Promoted in review.)*
- [F] Purchase orders (create, receive against PO).

**Pricing**
- [M] Cost price, MRP, sale price — per sale unit.
- [M] **Quantity-break (bulk) pricing** — price slabs by quantity (buy more → cheaper per unit), applied to all customers.
- [N] Item-level and category-level discounts.
- [F] Separate wholesale price list / customer-specific pricing.

**Control & visibility**
- [M] Low-stock / reorder-level alerts (per-item threshold).
- [M] **Barcode**: scan branded items at billing; search-by-name/code for loose/unbarcoded items. [F] generate + print labels.
- [M] Stock reports: on-hand, valuation, movement history, near-expiry.
- [M] **CSV/Excel bulk import** of catalog + opening stock.
- [N] Fast/slow-mover and profit reports.
- [F] Multi-store / multi-warehouse stock.

---

## Module 2 — Ecommerce (customer-facing)

**Storefront**
- [M] Browse by category, search, filter (brand, price, availability).
- [M] Product page: images, specs, **unit options** (per metre / kg / piece / litre), price, live stock status.
- [M] Quantity selector that respects sale units and step sizes.
- [N] Material calculators (paint per sq ft, wire per run, etc.).

**Buying**
- [M] Cart + checkout with **email/password customer accounts** (register/login to order).
- [M] Customer accounts: profile, addresses, **order history**, reorder.
- [M] **Local delivery + store pickup**; **flat delivery fee, free above a configurable threshold**.
- [M] Online payment via gateway (UPI/cards, e.g., Razorpay) **and** pay-at-store / pay-on-delivery.
- [N] Coupons / promotions.
- [N] Guest checkout (without an account).

**B2B / wholesale (IN SCOPE — confirmed)**
- [M] **Bulk/quantity-break pricing** shown to everyone (the chosen B2B model) — slabs flow straight from the catalog.
- [M] **GSTIN capture** at checkout so wholesale buyers get a proper tax (pakka) invoice.
- [M] **Buy on credit** for account customers — ties into the khata/credit ledger (Decision 7).
- [N] **Request-for-Quote** flow for large/custom orders; sales rep replies with a quote.
- [F] Customer-specific price lists / purchase orders.

**Operations**
- [M] **Order reserves stock on placement** with an **atomic decrement + reservation timeout** (abandoned carts auto-release) and a defined negative-stock policy. One shared inventory, no overselling. *(Tightened in review.)*
- [M] **Owner confirms order → pakka invoice generated on dispatch** (the sale becomes a saved tax invoice + final stock deduction at hand-over).
- [M] Admin order-management screen: accept → pack → dispatch → complete.
- [M] Order status + notifications (WhatsApp/SMS/email).

---

## Module 3 — Admin Billing (POS + invoicing)

**Counter billing**
- [M] Fast add-to-bill by search or barcode; keyboard-friendly.
- [M] Pick **sale unit** per line; auto price × qty; line + bill discounts; round-off.
- [M] **Manual rate override per line** (bargaining is normal in hardware), with an optional floor/permission. *(Added in review.)*
- [M] Payment modes: **cash, UPI, card, and credit (khata)**, with **part-payment** (pay part now, rest to khata) and cash change calculation.
- [N] Hold / resume bills.

**The two bill types (core requirement)**
- [M] **Kacha bill** — rough estimate, **no GST/tax breakup shown**, just items + amounts. **Zero trace**: no bill/value/cash/customer saved. Stock still decrements (the only footprint), appearing as an unattributed stock-out — so cash + that stock won't auto-reconcile (accepted).
- [M] **One-click convert kacha → pakka** before finalizing — the moment the sale becomes a saved, taxed invoice.
- [M] **Pakka bill** — saved permanently, gapless sequential number, full GST tax invoice, appears in reports + customer ledger.
- [M] **Print templates**: **thermal (2"/3") and A4/A5, selectable per bill**. Invoice shows shop logo + name + address + GSTIN, **bank details**, and **T&C / authorised-signatory** footer. *(No UPI QR on the bill, per selection.)*
- [N] **Saved quotation / estimate** (retrievable, has validity, converts to invoice) — distinct from kacha, for contractors who take an estimate away. *(Added in review.)*
- [N] **Delivery challan** (goods to site, bill later; links to the eventual invoice). *(Added in review.)*

**GST (confirmed registered)**
- [M] HSN codes, CGST/SGST/IGST auto-split, tax-inclusive/exclusive toggle, GSTIN on invoice.
- [M] **Place-of-supply rule**: intra-state → CGST/SGST; inter-state (e.g., online delivery to another state) → IGST.
- [M] **GST rounding** to nearest rupee; discount-applied-before-tax; MRP-inclusive back-calculation.
- [M] **GSTR-1 + HSN-summary export** (B2B / B2C / credit notes) so the accountant can file. *(Added in review — can't file GST without it.)*
- [N] **e-Way bill** generation for consignments above ₹50k.
- [F] **e-Invoice (IRN + QR)** — deferred (turnover < ₹5 cr). Switch-on module if turnover later crosses the threshold.

**After the sale**
- [M] Customer ledger / outstanding (receivables); payment reminders.
- [M] Sales returns / credit notes against pakka bills (credit note references the original invoice; partial returns; refund as cash / UPI / khata-adjustment).
- [M] **Invoice cancel / amend flow** — gapless numbering allows no deletes; cancel or issue a credit note instead. *(Added in review.)*
- [M] Day-end summary + sales reports (by day, item, category, payment mode).

---

## Cross-cutting

- [M] **Auth**: single owner/admin login for management + billing (no separate cashier/stock roles in v1; structured so roles can be added later). Separate **customer accounts** for ecommerce.
- [M] Single source of truth: inventory shared across ecommerce + billing.
- [M] Dashboard: today's sales, low stock, dues, top items.
- [M] **Audit / void log** of edits, voids, and deletions (financial integrity, even single-user). *(Promoted in review.)*
- [M] **Automated data backup + export** (statutory tax-record retention ≈ 6 years). *(Promoted in review.)*
- [F] Reports export to Excel/PDF; analytics over time.

## Suggested tech (the repo already points at Prisma)
- Prisma ORM (detected) → Node/TypeScript backend with PostgreSQL or MySQL.
- One database powering all three modules so stock stays consistent.
- Likely: a web admin (stock + billing) + a customer web storefront sharing the same API.
- *To confirm with you — frontend framework, hosting, online vs offline-capable billing.*

---

## Things worth flagging
- **Kacha = zero trace (your call).** Stock still decrements so counts stay right, but with no value/cash record the drawer won't auto-reconcile and kacha stock-outs read like adjustments. Owner accepts manual cash reconciliation for kacha.
- **A tax invoice (pakka) legally must be retained** if the business is GST-registered, so the "saved/not-saved" split lines up well with estimate-vs-invoice — good, standard design.
- **Unit-of-measure modelling is the highest-risk piece.** Worth designing this data model carefully before any UI.
