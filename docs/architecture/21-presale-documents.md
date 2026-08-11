# Pre-sale documents — Estimate, Proforma, Delivery Challan

**Status:** BUILT · **Date:** 2026-08-08
**Directive:** [mirror myBillBook](19-mybillbook-parity.md) — same screen order, same labels, same affordances.

---

## 1. The gap this closes

myBillBook's **Sales** menu has six entries. We had two (bill, bill history). The three that a hardware shop reaches for most often were missing entirely:

| myBillBook | What a shopkeeper uses it for | Was |
|---|---|---|
| **Estimate / Quotation** | "What will 200 bags of cement cost me?" — a contractor asks before ordering | ❌ |
| **Proforma Invoice** | Asking for money up front on a large order | ❌ |
| **Delivery Challan** | *"Maal bhej do, bill baad mein"* — goods go to site today, the bill follows | ❌ |

All three now exist at `/sales/estimates`, `/sales/proforma`, `/sales/challans`.

---

## 2. One document, three promises

They are the same shape — a party, priced lines, GST maths, a total — differing only in what they promise. So they are **one table with a `kind`**, one service, one form and one print template. Three near-identical copies would only be three places for a fix to be forgotten.

```
SalesDoc { kind: QUOTATION | PROFORMA | DELIVERY_CHALLAN, status: OPEN | CONVERTED | CANCELLED }
SalesDocLine   — mirrors InvoiceLine field-for-field
SalesDocCounter — own sequence per (shop, kind, FY)
```

`SalesDocLine` mirroring `InvoiceLine` is deliberate: conversion is then a straight copy with nothing to re-derive.

**Numbering is per kind.** `QT/2026-27/000001` and `DC/2026-27/000001` coexist, each starting at 1 — the way a shopkeeper expects, and the way myBillBook does it. The allocation uses the same `UPDATE … RETURNING` row lock as the invoice counter, so concurrent quotes cannot collide.

---

## 3. The line these documents do NOT cross

None of them is a tax invoice, and the code enforces that structurally rather than by convention:

- **No invoice number is minted.** The GST series must stay gapless *and* every number in it must correspond to a real tax invoice. A quotation that is never accepted cannot be allowed to burn one. (Verified: the invoice counter is untouched by creating documents.)
- **No tax liability, no ledger entry, no stock movement.** Nothing has been sold. Stock moves when the document is converted and the bill finalises — through the ordinary, already-tested `finalizePakka`, not a second path.
- **The print template is not the invoice template.** It carries no "Tax Invoice" wording and ends with an explicit disclaimer. Printing a quotation on invoice stationery would produce something that *looks* claimable while carrying no invoice number.
- **They are editable and cancellable.** A finalised invoice is neither.

### The honest caveat: a delivery challan does not reduce stock

Goods can physically leave on a challan while the app still counts them as on hand. myBillBook makes this a setting; we do not have it yet.

The alternative — decrement here and attribute on convert — is exactly the kacha→pakka dance, and getting it wrong **double-deducts real inventory**, which is far worse than a stock figure that is briefly optimistic. Until that is built and tested, the challan screen says so in plain words ("Stock is reduced when you convert this to a bill — not now") rather than quietly reporting the wrong number. **This is the top candidate for the next slice.**

---

## 4. Convert → bill

**"Convert to bill" does not create the invoice.** It hands the document to the counter — `/billing?fromDoc=<id>` — which loads the lines into the cart with a banner naming the source document.

Why not one click: quantities and rates routinely change between the quote and the sale, and a finalised invoice **cannot be edited afterwards**. A one-click conversion would raise a bill the shopkeeper never got to look at. This also matches myBillBook, which opens the invoice form prefilled.

Three details that matter:

- **The quoted rate is carried as an explicit `rateOverride`**, not left to the catalog. The customer was promised that number; a catalog price change since then must not silently move it.
- **Only an OPEN document prefills.** A cancelled or already-billed one must not quietly become a second bill.
- **Items outside the first catalog page are fetched server-side** before the cart is seeded — otherwise the cart would hold a line the client cannot price or name.

The document is stamped `CONVERTED` **after** the invoice exists, deliberately outside the invoice transaction: the sale is real either way, so a failure to stamp is a warning to retry, never a failed bill. Double-conversion is impossible because the guard is `WHERE status = 'OPEN'` inside the `updateMany` — two operators racing the same quote each raise their own invoice, but only one update matches and the second is told so.

---

## 5. Permissions — no new keys

Sales documents reuse `bill.pakka.create` (write) and `bill.read` (read).

A pre-sale document is a **weaker** power than the bill it may become: anyone allowed to raise a tax invoice can certainly offer a price. Reusing the billing permissions keeps this out of the RBAC seed entirely and cannot widen anyone's access, because every holder already has the stronger right.

---

## 6. Reuse, not reimplementation

The form is the POS's model in a different frame — same `/api/products` typeahead, same `PosCustomerPicker`, same client-side `previewTotals` mirror of the server's tax engine, same quick-add for a missing item. What a shopkeeper learns at the counter transfers here without being re-taught.

Server-side, `priceLines` calls the **same** `loadLineCatalog`, the **same** UoM conversion and the **same** pure `computeInvoiceTotals` that billing uses. That equality is the point: *a quote whose total differs from the bill it becomes is worse than no quote at all.*

---

## 7. Verification

Against the live database, with every test row removed afterwards:

- Estimate created → `QT/2026-27/000001`, ₹5,466.00; totals reconcile (`taxable + tax + roundOff == grandTotal`); intra-state split is CGST+SGST; quoted rate honoured to the paisa; line names resolve.
- **No stock movement written**; **invoice counter untouched** (`lastNo = 0`).
- Revision replaces the line set, changes the total, applies a bill discount, and **keeps the same number**.
- Challan numbers on its own `DC/` series; "valid till" is dropped for non-quotations rather than printing a meaningless date.
- **Full convert path:** challan → real invoice `2026-27/000001`; the quoted rate survived into the bill; **stock moved at bill time, not challan time** (200 → 195); document stamped and traceable to the invoice; **second conversion refused**; **a billed document is frozen against editing**.
- All **332 core unit tests** pass; both workspace packages typecheck.
- Every route returns 200 for a signed-in owner: the three lists, `new`, detail, `edit`, and `/billing?fromDoc=…`.
- **Verified visually end-to-end in the browser**: typeahead → add item → qty 50 → live totals (₹21,000 taxable, CGST ₹2,940, SGST ₹2,940, ₹26,880 total at 28%) → save → list → printable document with HSN 2523 and the disclaimer → **Convert to bill** → POS opened with the banner and the cart pre-loaded at the quoted rate.

**One bug found and fixed in the verification script itself** (not in the shipped code): the cleanup restored stock by a computed delta instead of a snapshot, leaving cement at 400 instead of its seeded 200. Detected, diagnosed against the seed, and corrected — all ten products now sit exactly at their seeded opening stock.

---

## 8. Open decisions

- **Should a delivery challan reduce stock?** (§3) — the real remaining gap. Needs the attribute-on-convert path so conversion cannot double-deduct.
- **Expenses, Purchase Order, and a unified Parties screen** are the next myBillBook menu entries we do not have.
- **Partial conversion** — billing half a quotation and leaving the rest open. myBillBook does not do this either; a shop splits the quote instead.
