# Parties — one directory

**Status:** BUILT · **Date:** 2026-08-11
**Closes:** the Parties entry in myBillBook's menu — the last one we did not have.

---

## 1. What it is

`/parties` — everyone the shop buys from and sells to, in one list, with what is owed in either direction.

A shopkeeper does not think "customers screen" and "suppliers screen". They think *"who do I owe, and who owes me"*. This is that list, ordered **biggest balance first** — a call sheet, not a phone book.

---

## 2. The decision that shaped everything: unify the SCREEN, not the tables

myBillBook has one `parties` table. We keep `Customer` and `Supplier` separate and merge them in a **read model**.

Merging for real would mean rewriting every foreign key in the two areas that handle money — `Invoice`, `Order`, `LedgerEntry`, `Address`, `CustomerAccount`, `SalesDoc` on one side; `GoodsReceipt`, `SupplierPayment`, `PurchaseOrder` on the other. That is an enormous, high-risk migration in exchange for a screen.

And the two are genuinely not the same thing:

| | Customer | Supplier |
|---|---|---|
| Storefront login | ✅ `CustomerAccount` | ✕ |
| Khata / ledger | ✅ signed `LedgerEntry` | ✕ (balance is derived) |
| Receives a purchase order | ✕ | ✅ |
| Price type (retail/wholesale) | ✅ | ✕ |

So the screen is unified and the models stay. **Consequence, stated plainly:** an organisation that both buys and sells appears **twice**, once per role — which is also correct, because its khata and its payable are genuinely different balances.

---

## 3. One balance column, one meaning

The list shows a single `balance`, signed from the **shop's** point of view:

- **positive → "to collect"** (a customer's khata balance)
- **negative → "to pay"** (a supplier's unpaid purchases)

One column that always means the same thing is what lets the list be read top to bottom without switching mental models. Zero renders as a dash, so the eye lands on the rows that need chasing.

**Where each number comes from:**

- **Customer** — `SUM(LedgerEntry.amount)`, which is already signed by convention (+ debit / − credit). One `groupBy` for the whole list rather than N calls to `outstanding()`.
- **Supplier** — goods received minus payments recorded. The goods value needs `GrnLine` joined to `GoodsReceipt` (the line carries no supplier) and Prisma's `groupBy` cannot join, so that one is raw SQL with `shopId` **bound as a parameter**, never interpolated.

⚠️ **The supplier figure is purchases-received minus payments, not an invoice-matched payable.** The shop may have been billed for goods not yet entered, or entered goods not yet billed. It is the honest number available from what the app actually records, and the screen labels it as such ("Goods received from suppliers, not yet paid for").

---

## 4. Smaller choices

- **Opening balance, customers only.** A shop moving off a paper khata has real balances on day one; starting everyone at zero makes the first statement wrong and the shopkeeper stops trusting the screen. New `setOpeningBalance()` posts a single audited `OPENING` entry — a transaction on the statement, not a hidden column — and **refuses once the khata has any history**, because an "opening" balance added after trading has begun is an unexplained adjustment, and there is a separate entry type for that. Suppliers have no ledger, so the field is **absent** for them rather than accepted and dropped, and the form says why.
- **Add party is one form over two tables.** `kind` decides which core service runs; nothing is re-implemented, so a party added here is identical to one added from the ledger or the suppliers page. Fields that apply to one side appear only for that side.
- **Permission-scoped, not permission-gated.** A role with `customers.read` but not `suppliers.read` gets a customer list, not a 403 — and the counts and totals reflect only what they may see.
- **"Remind" is one tap**, and only appears where it makes sense: a party with a phone number *and* money owed to the shop. It deliberately does **not** reuse `buildWhatsAppUrl` — that formats a *bill*, and feeding it an empty invoice would send "Bill · 11 Aug 2026" with a blank item list. Only `normalisePhone` is shared.
- **No cursor pagination.** Two independently-paginated sources cannot be merged into one correctly-ordered list with cursors. Both are read whole, capped at 2,000 each, and the cap says so rather than silently truncating.

---

## 5. Navigation

The sidebar's **Ledger** entry becomes **Parties**, with the khata as a tab inside it (*All parties · Khata & dues*). A shopkeeper looks up a **person** and then asks what they owe — not the other way round.

Two supporting fixes:

- `NavItem.matchPrefixes` — a section whose tab bar reaches routes outside its own folder (Parties → `/ledger`) would otherwise leave the sidebar with nothing highlighted, which reads as having navigated out of the app.
- `LedgerNav` was a **single-item** tab bar; it is replaced by the real section nav.

Supplier admin stays in the Stock section, where goods receipts and purchase orders already live. It is **not** a tab here — a tab that jumps the user into a different sidebar entry is worse than a row link that clearly goes elsewhere. Clicking a supplier row goes to `/stock/suppliers?highlight=<id>#supplier-<id>`, which **marks and scrolls to that row**: a link that says "this one" and then shows an undifferentiated table is worse than no link.

---

## 6. Verification

20 checks against the live DB, everything removed afterwards and all ten products confirmed back at their seeded opening stock:

- A customer with a ₹2,500 opening balance shows **+₹2,500 "to collect"**; a supplier with ₹4,000 received and ₹1,500 paid shows **−₹2,500 "to pay"**.
- A second opening balance is refused once the khata has entries.
- Rows sort by size of balance; counts cover both tables; totals split correctly by direction.
- Filters: `kind` excludes the other side, search matches **name (case-insensitive), phone and GSTIN**, `hasBalance` drops settled parties.
- Permission scoping: a customers-only role sees no suppliers and a suppliers-only role sees no customers, in the rows, the counts *and* the totals.
- Recording a ₹1,000 payment moves the balance from ₹2,500 to ₹1,500 — the directory reads live, not a cached figure.

Rendering checked over HTTP: the two totals cards, the All/Customers/Suppliers chips, the sorted rows with their "to collect"/"to pay" labels, "Remind" appearing only on the debtor, the supplier row landing on a highlighted `#supplier-<id>`, `/ledger` keeping the section nav, and the add-party form showing "Opening balance" and "Price type" only for a customer.

348 core tests pass; both packages typecheck. **No migration** — this slice adds no columns.

---

## 7. What it does not do

- **No party detail page of its own.** Rows link to the existing khata statement or the supplier directory. A single unified party page (transactions both ways, one "collect / pay" button) is the natural next step.
- **No edit or delete from this screen** — it is a directory and an entry point.
- **No party-wise "Pay" action for suppliers.** `SupplierPayment` exists and is counted here, but nothing in the UI records one yet; that is the real remaining gap on the buying side.
- **No party categories or party-wise reports**, both of which myBillBook has.
