# Purchase orders

**Status:** BUILT, incl. partial receipt (§7) · **Date:** 2026-08-10, updated 2026-08-11
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

## 7. Partial receipt

*Added 2026-08-11.* Cement arrives on two trucks; that is the normal case, not an edge one. An order can now be received in **as many lots as it takes**, and it stays visible until the last one lands.

### The model change

The single `PurchaseOrder.receivedGrnId` pointer was wrong — it could only ever name one delivery. It is replaced by **`GoodsReceipt.purchaseOrderId`** (many receipts per order), and each order line carries:

| Column | Meaning |
|---|---|
| `baseQty` | what was ordered, in **base units**, snapshotted at order time |
| `receivedBaseQty` | what has actually arrived so far, accumulating across deliveries |

Plus a `PARTIAL` status, **derived from the lines on every receipt, never set by hand**.

### Three rules that decide correctness

**Progress is tracked in base units, and matching ignores the unit each side used.** An order for 20 bags of cement is satisfied by a receipt of 1000 kg. Any other rule leaves the order open forever, because shops routinely order by the bag and receive by weight.

**`baseQty` is snapshotted, not re-derived.** If someone later edits a sale unit's conversion factor, converting on the fly would retroactively change how much was once ordered. The same reasoning as `InvoiceLine.baseQty`.

**Over-delivery is recorded in stock but not credited past the order.** A supplier sending 120 of an ordered 100 books 120 into stock — that is the truth — while the order closes at 100. Crediting 120 would make every outstanding figure downstream wrong.

The allocation itself is a pure function, `allocateReceipt`, with **11 unit tests**: accumulation across deliveries, over-delivery, spill-over when the same product appears on two lines, an unordered extra item, a line already full, and fractional base quantities.

### What changes in the UI

- **The receive form is seeded with what is OUTSTANDING**, not what was originally ordered. On the second lot of a part-delivered order, offering the full quantity again is exactly how stock gets double-counted.
- Reducing a quantity on the receipt is now meaningful: whatever is left **stays on the order** for the next delivery, and a toast says what is still owed rather than letting the operator assume it is closed.
- The order shows **Ordered / Received / Pending** per line once anything has arrived, plus a list of the deliveries.
- A part-received order **can still be received** ("Receive the rest") and **can still be cancelled** ("Write off the balance") — the supplier-cannot-deliver case is precisely why cancelling exists, and what already arrived stays received. It **cannot be edited**: its remaining quantities are derived from the lines the first delivery was checked against.
- Double-crediting is impossible: `GoodsReceipt.purchaseOrderId` is set when a receipt is credited and checked first, so the same receipt can never be counted twice.

### Verified

29 checks against the live DB — order 100 → receive 60 → receive 40 — with everything removed afterwards and all ten products confirmed back at their seeded opening stock:

- First delivery: status `PARTIAL`, received 60, pending 40, `receivedAt` still null, one delivery listed, **stock rose by 60 only** (500 → 560).
- A part-received order cannot be edited; the same receipt cannot be credited twice; the counts show it as partial.
- Second delivery: complete, status `RECEIVED`, received 100, pending 0, `receivedAt` set, both deliveries listed, stock at +100.
- A fully received order cannot be cancelled; a **part-received one can**, and what already arrived stays recorded.
- Rendering checked over HTTP: the "Part received" badge, the Ordered/Received/Pending columns showing 60 and 40, "Receive the rest", "Write off the balance", the deliveries list — and the receive form pre-filled with **`value="40"`**, the remainder rather than the original 100.

348 core tests pass. The migration drops a column and an index, which is safe here and recorded in the migration header: both tables were verified **empty** immediately beforehand, and the dropped column shipped only in the immediately preceding (unpushed) commit.

---

## 8. What it still does not do

- **No supplier-facing send.** Print works; there is no e-mail or WhatsApp of the order yet.
- **No purchase returns / debit notes**, which is myBillBook's remaining Purchases entry.
- **No "close short" on a partial order without cancelling it.** Writing off the balance marks the whole order cancelled, which slightly understates that most of it did arrive. A dedicated `CLOSED_SHORT` state would read better on a report.
