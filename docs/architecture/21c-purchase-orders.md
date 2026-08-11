# Purchase orders

**Status:** BUILT · **Date:** 2026-08-10
**Closes:** the Purchase Order entry in myBillBook's Purchases menu.

---

## 1. What it is

`/purchases` — what you have asked a supplier to send, before it arrives. Raise it, print it or send it, then **receive** it when the truck turns up.

## 2. It is the buying-side mirror of the sales documents

Deliberately the same shape and the same flow as [21](21-presale-documents.md), so a shopkeeper learns the pattern once and it works in both directions:

| | Sales side | Buying side |
|---|---|---|
| The promise | Estimate / Proforma / Challan | **Purchase order** |
| Becomes | a GST bill | **a goods receipt (GRN)** |
| Stock moves | at bill time | **at receipt time** |
| How it converts | prefills the POS | **prefills the GRN form** |
| Numbering | `QT/` `PI/` `DC/` per FY | **`PO/` per FY** |

A PO moves no stock and creates no payable. It becomes real through the ordinary, already-tested `recordGrn` path — not a second one.

---

## 3. Two decisions worth arguing about

### No GST on a purchase order

A sales document carries a full CGST/SGST/IGST breakup. A purchase order carries none, and that asymmetry is deliberate: **`GoodsReceipt` stores `costPerBaseUnit` and nothing else.** A tax figure typed on an order would silently evaporate the moment the goods were received — the "switch that does nothing" problem already identified in [19 §10](19-mybillbook-parity.md).

Quantity × rate is what a small shop's purchase order actually says. The printed document states plainly that rates exclude whatever tax the supplier's invoice adds. If purchase-side GST is ever wanted, it belongs on the GRN first; the PO can follow.

### "Receive goods" does not book stock in one click

It hands the order to the goods-receipt form (`/stock/grn?fromPo=<id>`) with the lines loaded, because what arrives is routinely not what was ordered — short deliveries, substituted brands, a different rate on the invoice. One-click receiving would record a receipt nobody checked, against stock that cannot be un-received without an adjustment.

Same rules as the sales-side conversion:
- **Only an OPEN order prefills.** A cancelled or already-received one must not quietly book a second lot of stock.
- **The order is stamped RECEIVED after the GRN commits**, outside its transaction. Stock is booked either way, so a failure to stamp is a warning to retry, never lost stock.
- **Double-receiving is impossible**: the guard is `WHERE status = 'OPEN'` inside the `updateMany`. Two people racing the same order each record their own receipt, but only one update matches and the second is told so.

---

## 4. Smaller choices

- **Permissions reuse `stock.grn` (write) and `stock.read` (read).** Ordering goods is a weaker power than receiving them — anyone trusted to book stock in can certainly ask a supplier for a price. No new RBAC keys.
- **Supplier is required** and its name is **snapshotted**, so renaming a supplier later does not rewrite an order already sent.
- **The rate pre-fills from the item's last known cost**, converted into whatever unit is being ordered. A purchase rate is usually the same as last time; a blank field is not. Changing the unit **re-derives** the rate rather than leaving a number that now means something else.
- **`listPurchaseCatalog` is a new staff-only read.** The ordinary product DTOs omit `costPerBaseUnit` on purpose — the storefront shares them, and a shop's buying price is not public. Rather than widen a public DTO, the order form gets its own projection.
- **It lives under the Stock section's tab bar, not a twelfth sidebar entry.** Goods receipts and suppliers are already there; purchasing split across two places is worse than purchasing one click deeper. This is a deliberate deviation from myBillBook's top-level Purchases menu.
- **Back-dateable**, and the `PO/` series follows the document date, like every other document ([21b §5](21b-expenses.md)).

---

## 5. Fixed while building

`GrnForm`'s receive-unit `<Select>` was **uncontrolled** (`defaultValue`), which had a latent bug independent of this feature: changing a line's product left the unit dropdown showing the new item's options while the browser silently picked one, so a line could post a unit that belonged to the previous product. It is now controlled, and changing the product resets the unit explicitly. The core service always rejected that pair (`NOT_FOUND`) — verified below — so it was a usability failure rather than a data one.

---

## 6. Verification

23 checks against the live DB, with **every row removed afterwards** and stock restored by snapshot-and-set rather than a computed delta:

- Order created → `PO/2026-27/000001`; subtotal = qty × rate to the paisa; supplier name snapshotted; unit label resolves.
- **Ordering moves NO stock** (500 → 500).
- Revision re-prices and **keeps the same number**.
- **Stock goes up at RECEIPT time** (500 → 525, +25 base units through the real `recordGrn`).
- Order marked received; the receipt is traceable back from the order.
- **Cannot be received twice**; a received order is **frozen** against editing and **cannot be cancelled**.
- **A sale unit belonging to a different item is refused** — cross-product spoofing blocked.
- Cleanup verified: stock restored exactly, no orders, no test supplier, and all ten products back at their seeded opening stock.

Rendering checked over HTTP for a signed-in owner: `/purchases`, `/purchases/new`, the status filter, the detail page, and `/stock/grn?fromPo=…` — which showed the banner naming the order with quantity `7` and rate `123.45` seeded into the form, and ₹864.15 on the list (7 × 123.45 ✓). `?fromPo=nonexistent` degrades to a plain receipt form rather than erroring.

337 core tests pass; both packages typecheck; the migration is purely additive (zero DROP statements).

---

## 7. What it does not do

- **No partial receipt.** Receiving marks the whole order received, even if the operator reduces the quantities on the receipt. "I ordered 100 bags, 60 came, 40 pending" is invisible — a real hardware-shop case, and the top candidate for the next slice. It needs a received-quantity per line and a `PARTIAL` status.
- **No supplier-facing send.** Print works; there is no e-mail or WhatsApp of the order yet.
- **No purchase returns / debit notes**, which is myBillBook's remaining Purchases entry.
