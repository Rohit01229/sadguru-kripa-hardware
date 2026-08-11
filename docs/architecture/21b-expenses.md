# Expenses — the shop's money going out

**Status:** BUILT · **Date:** 2026-08-09
**Closes:** the biggest single missing myBillBook menu entry after [21](21-presale-documents.md).

---

## 1. What it is

`/expenses` — rent, electricity, wages, freight, tea, repairs. Everything a shop pays for that **is not stock**.

Stock purchases are deliberately *not* expenses here. They already have a home in goods receipts, and counting them in both places would make every total wrong.

## 2. What it is NOT

**Not double-entry.** There is no P&L for it to feed yet, and half an accounting system is worse than an honest register. What this answers today is the question a shopkeeper actually asks — *"where did my month go?"* — and it answers it with a category breakdown, not a balance sheet.

When a P&L is built, this table is already the input it needs.

---

## 3. The one design decision that matters

**The form asks for the GROSS amount — what actually left the till.**

myBillBook asks for the taxable value and adds tax on top. We ask for ₹1,180 and derive ₹1,000 + ₹180, because ₹1,180 is the number printed on the freight bill and the number on the bank statement. The shopkeeper should never have to do arithmetic to enter what they already know.

The split uses the **same** `backCalcTaxable` helper that MRP-inclusive pricing uses, and the CGST/SGST halves are computed so the remainder lands on SGST — the two halves sum *exactly* to the tax, with no paisa lost. `splitAmount` is a pure function with **5 unit tests**, including a sweep over every rate × amount combination asserting `taxable + cgst + sgst + igst === total`.

GST itself is behind a toggle, off by default: rent, wages and tea carry none, and that is most of what a shop pays for.

---

## 4. Other choices, briefly

- **Its own permissions, `expenses.read` / `expenses.write`** — not a reuse of `ledger.*`. Customer khata and the owner's payroll are different sensitivities: a counter role that needs to see what a customer owes should not thereby see salaries. (Two new keys, seeded; OWNER holds all 35.)
- **Starter categories seeded on first use** — 11 of them, hardware-shop specific (Rent, Transport & Freight, Tea & Refreshments…). Same "no masters wall" rule as the catalog: a shop must never be sent to a set-up screen before it can record that it paid the electricity bill. Seeds only when the shop has none, so a curated list is never touched.
- **The category dropdown starts empty**, on "Choose a category…". Defaulting to `categories[0]` would pre-select whatever sorts first — "Bank Charges" — and a pre-selected wrong answer gets saved. This is the same bug the catalog hit in 19 §9, caught here before it shipped.
- **Add a category inline**, without leaving the form — the same affordance items and parties have. A duplicate name returns the existing row rather than erroring: the intent is satisfied either way.
- **Delete is a real delete**, unlike an invoice — a mistyped expense is a typo in a private register, not a document a customer is holding. The full row is snapshotted into the audit log first, so it stays recoverable. The button arms before it fires; no modal.
- **Defaults to the current month.** "What have I spent this month" is the question; a range bar (shared with the reports) widens it. The `to` bound is pushed to end-of-day so an expense recorded at 2pm on the last day is not silently excluded.

---

## 5. Back-dating (also added to pre-sale documents)

Both Expenses and the [pre-sale documents](21-presale-documents.md) now carry an editable **date**, defaulting to today. Bills are entered days after they are paid and quotes are written up after they are given — pretending otherwise made the register wrong.

Two rules:

- **The number series follows the DOCUMENT date, not the clock.** A quote back-dated to 15 March 2026 gets `QT/2025-26/000001` — last financial year's sequence — exactly as an invoice would.
- **Correcting a date does NOT re-mint the number.** The customer is already holding a copy that carries it.

`todayIso()` builds the default from local date parts rather than `toISOString()`, which would shift a late-evening IST entry to yesterday.

---

## 6. Verification

- **337 core unit tests pass** (5 new), both packages typecheck.
- Migration `20260809100000_expenses` — purely additive, zero DROP statements; applied to the live DB.
- Seed re-run: **35 permissions**, OWNER mapped to all, owner login untouched.
- **Verified in the browser end-to-end**: 11 starter categories seeded on first visit → ₹1,180 freight at 18% showed ₹1,000 before tax + ₹180 CGST+SGST *before* saving → saved as `EXP/2026-27/000001` → the list showed ₹1,180 spent, 1 entry, ₹180 input tax, and a 100% Transport & Freight breakdown → the edit form reloaded with the GST toggle and split intact.
- **Back-dating verified in the browser**: an estimate dated 15 Mar 2026 was numbered `QT/2025-26/000001` and sits beside `QT/2026-27/000001` dated 8 Aug 2026 — two independent series, correctly assigned.

**One issue found and fixed during verification:** a stale service worker was serving the previous client bundle, so the new sidebar icon resolved to `undefined` and the shell crashed with *"Element type is invalid… check NavList"*. Not a code defect — but worth knowing that after adding a nav entry, a hard refresh (or clearing the SW) is needed on an already-open tab.

---

## 7. What Expenses still does not do

- **No bill photo attachment.** myBillBook lets you snap the receipt. We have Cloudinary wired for product images already, so this is small — just not built.
- **No recurring expenses.** Rent is the same number every month and re-typing it is friction.
- **No P&L.** Expenses + sales is nearly enough for a simple one; the missing piece is cost-at-sale on invoice lines (19 §11).
