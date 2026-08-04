# SaaS Platform — Base Plan (myBillBook-style billing SaaS)

**Status:** Foundation doc — the base we build the pivot on. Assumptions are marked **[CONFIRM]**; strategic decisions are collected in §10.
**Date:** 2026-07-26
**Author:** planning pass (myBillBook research + current-codebase knowledge)

---

## 0. Why this doc exists

Today the project is a **single-shop** app (one hardware store: one `StoreConfig`, one invoice counter, one set of products). Real users found it **too hard to use**. The new direction:

1. **Become a SaaS** — a platform where **you (super-admin) create and manage many shops**, and each shop owner gets their own account.
2. **Make the shop-owner experience as simple as myBillBook** — because that simplicity is exactly what our users were missing.

This doc is the shared base: what myBillBook does well, what we keep vs rebuild, the multi-tenant architecture, and a phased roadmap.

---

## 1. The pivot in one picture

```
                       ┌──────────────────────────────────────┐
                       │        PLATFORM SUPER-ADMIN (you)      │   ← new
                       │  create shops · plans · billing ·      │
                       │  support · usage · impersonate         │
                       └───────────────────┬────────────────────┘
                                           │ provisions
              ┌────────────────────────────┼────────────────────────────┐
              ▼                             ▼                             ▼
        ┌───────────┐               ┌───────────┐               ┌───────────┐
        │  Shop A    │               │  Shop B    │               │  Shop C    │   ← tenants
        │ owner+staff│               │ owner+staff│               │ owner+staff│
        │ SIMPLE app │               │ SIMPLE app │               │ SIMPLE app │
        └───────────┘               └───────────┘               └───────────┘
              └───────────────── one shared database, isolated by shopId ─────┘
```

Three audiences, three experiences:
- **Platform super-admin** — *you*. Onboard/suspend shops, set plans, see usage/revenue, help customers.
- **Shop owner + staff** — the tenant. A **dead-simple** billing/inventory/GST app (the myBillBook experience).
- **(Optional) Customers** — the existing B2C storefront, per shop, if we keep it **[CONFIRM]**.

---

## 2. myBillBook teardown — flows & the simplicity we copy

Grounded in myBillBook's own site + help docs (see Sources). Their winning flows:

**Onboarding (minutes, not hours):**
- **OTP phone login** — enter phone → OTP → in. No password, no email verification.
- Create a **Business** (name, logo, GSTIN, address, state) — one short form.
- **Bulk import** parties (customers/suppliers) and items from **Excel / Tally / Vyapar / Busy**, so day-1 isn't manual typing.

**Daily billing (the core loop — seconds):**
- One **"Create Invoice"** screen: pick a **party** (or "cash sale"), add **items** (search or **barcode scan**), qty auto-fills price + **pre-set GST%** → totals compute live.
- Tap **Save & Share** → print (**A4 / A5 / thermal 2"/3"**) or send **PDF / WhatsApp / SMS**.
- Everything else (HSN, CGST/SGST split, round-off) is **automatic** — the shopkeeper never does tax math.

**Beyond billing (same simple pattern):**
- Quotations/estimates, delivery challans, purchase bills, payments/receipts (one payment → many invoices).
- Party **ledger/statement**; item **stock + low-stock reminders**; **20+ reports**.
- GST: auto **GSTR-1** data, **e-invoice (IRN)** and **e-way bill** for those who need it.
- **Custom invoice themes** with **live preview**, colors/fonts/logo, saved templates.
- Regional language (Hindi/Hinglish/Gujarati/Tamil), keyboard shortcuts, cloud sync across phone + web.

**The 7 simplicity principles we adopt:**
1. **OTP login** — kill passwords for shop users.
2. **Sensible defaults everywhere** — GST% on the item, cash-sale party, today's date, default template.
3. **One-screen billing** — party + items + save, nothing else required.
4. **Search/scan to add**, not forms.
5. **Automatic compliance** — tax, HSN, numbering are invisible to the user.
6. **Bulk import** to remove onboarding pain.
7. **Share, don't just print** — PDF/WhatsApp is the modern receipt.

> We are **not** copying myBillBook's breadth on day one — we're copying its **feel**. Ship the simple core loop first.

---

## 3. What we keep vs rebuild

**Keep (our real asset — a strong, correct GST billing core):**
- `@hardware/core` domain logic: **finalizePakka / finalizeKacha**, tax orchestration (CGST/SGST vs IGST by place-of-supply), **gapless InvoiceCounter numbering**, credit notes, ledger/khata, inventory (GRN/stock/adjustments), reports, audit. This is exactly what myBillBook took years to get right — we already have it.
- Prisma/Postgres (Neon) + Next.js 15 + Vercel stack.
- Cloudinary images; the bill-templates plan ([15-bill-templates-and-editor.md](15-bill-templates-and-editor.md)); PWA install.

**Rebuild / add (the reason users struggled):**
- **Multi-tenancy** — the app assumes ONE shop today (§5). This is the big engineering pivot.
- **The shop-owner UX** — re-skin around the simplicity playbook (§6). Fewer screens, one-screen billing, OTP login, defaults.
- **Platform super-admin** — brand new (§4).
- **Auth** — add **OTP/phone** for shop users (keep email/password for platform admin).
- **Onboarding + bulk import.**

**Confirmed:** the **B2C storefront** stays as an **optional per-shop add-on** (myBillBook has none; de-prioritised, code kept).

---

## 4. The three planes

### 4a. Platform Super-Admin (new — for you)
A separate app/realm (`admin.ourplatform.com` or `/platform`), **not** a shop. Capabilities:
- **Shops (tenants):** create, edit, suspend, delete; assign the owner; set **plan/limits**.
- **Plans & subscriptions:** define tiers (e.g. Free/Pro/Enterprise), per-shop limits (users, invoices/mo, e-invoice on/off), trial + expiry.
- **Billing the shops:** track subscription status, dues (payments integration later).
- **Usage & health:** invoices created, active users, storage, errors per shop.
- **Support:** **impersonate / "log in as shop"** (audited) to help a customer; reset an owner's login.
- **Platform staff & roles.**

### 4b. Shop Owner + Staff (the tenant — the simple app)
The evolved current admin, scoped to ONE shop and simplified. Modules (§7). Owner manages staff + roles within the shop; staff get limited access (e.g. billing only).

### 4c. Customers (optional per-shop storefront) — confirmed
The existing storefront, per shop, as an **optional module a shop can enable/disable**. De-prioritised for the myBillBook-style pivot (they have no storefront); the code is kept, not deleted.

---

## 5. Multi-tenant architecture (the core engineering pivot)

### 5a. Isolation model — **Recommended: shared database, row-level `shopId`**
| Model | Isolation | Cost/ops | Fit |
|---|---|---|---|
| **Shared DB + `shopId` column** (row-level) | Logical, enforced in code | **Lowest** — one Neon DB, one migration set | **✅ Recommended** for our scale + Vercel/Neon |
| Schema-per-tenant | Stronger | Medium — N schemas, migration fan-out | Overkill now |
| DB-per-tenant | Strongest | High — provisioning, connection sprawl | Only for enterprise/compliance later |

**Why row-level:** cheapest to run on Neon, one migration path, and Postgres is fine to thousands of tenants this way. The whole discipline is: **every business row carries `shopId`, and every query is scoped to the caller's shop.** (Postgres **Row-Level Security** can be added later as defense-in-depth.)

### 5b. Data-model change (the heart of the work)
- New root: **`Shop`** (id, name, slug/subdomain, plan, status, createdAt, ownerUserId …) and **`Plan`/`Subscription`**.
- Add **`shopId`** (FK → Shop) to **every business table**: Product, Category, Brand, Unit, ProductStock, StockMovement, Invoice, InvoiceLine, Payment, CreditNote, Customer, Address, LedgerEntry, Supplier, GoodsReceipt, Order, InvoiceCounter, CreditNoteCounter, AuditLog, **StoreConfig**, and the planned **BillTemplate**.
- **`StoreConfig` becomes per-shop** (today it's a single `"default"` row — it turns into one row per `shopId`).
- **`InvoiceCounter` / `CreditNoteCounter` become per-shop** — gapless numbering is now **per shop** (each shop has its own SKH/2026-27/0001 series). Critical: the row-lock numbering logic already exists; just key it by `shopId`.
- **Uniqueness scoping:** unique constraints that are global today (e.g. `Product.sku`, invoice number per FY, category/brand name) become **unique per `shopId`** (composite `@@unique([shopId, sku])`, etc.). This is a required, careful migration.

### 5c. Enforce isolation once, in the core
The single most important safety rule: **no core service runs without a shop context.**
- Every `@hardware/core` service takes a `ctx` that already includes `shopId` (we already thread a `Session` ctx for RBAC — extend it with `shopId`).
- Provide a **scoped data accessor** — a thin wrapper that auto-injects `where: { shopId }` (a Prisma `$extends`/client middleware or a `forShop(shopId)` helper), so a developer can't forget it.
- Result: a shop can **never** read/write another shop's data, enforced in one place, not sprinkled across pages.

### 5d. Tenant resolution + routing
- **Primary:** the **logged-in user belongs to a shop** (a `ShopMembership` join). After login, the session carries `shopId` → everything is scoped. Simplest, no DNS work.
- **Optional later:** subdomain per shop (`myshop.ourplatform.com`) or path (`/s/myshop`) for branding/deep links. Vercel wildcard domains + middleware resolve the tenant.
- Platform super-admin is its **own realm** (separate cookie namespace, like today's staff-vs-customer split) so a super-admin session can't be confused with a shop session.

### 5e. Auth realms (three, cleanly separated)
1. **Platform staff** (you) — email/password (+ 2FA later).
2. **Shop users** (owner/staff) — **OTP phone login** (myBillBook-style simplicity) — new. A shop owner is **created by the super-admin** (no self-serve signup); staff are then invited by the owner.
3. **(Optional) Customers** — existing customer realm, per shop.

---

## 6. Simplicity playbook (turn §2 lessons into rules)

Concrete rules for the shop-owner app so it *feels* like myBillBook:
- **Login:** phone + OTP. No password screens for shop users.
- **Home = "New Sale".** The billing screen is the landing page, not a dashboard.
- **Billing screen:** party (default "Cash Sale") → add items by **search or barcode** → qty → **Save & Share**. Tax/HSN/round-off/number are automatic and shown, never entered.
- **Defaults:** GST% lives on the item; date defaults to today; payment defaults to "Paid/Cash"; template defaults to the shop's chosen one.
- **Add-on-the-fly:** create a new item/party from inside the billing screen (a small modal), no context switch.
- **Onboarding wizard:** 3 steps — business details → import or add a few items → make your first bill. Offer **Excel import** immediately.
- **Share first:** every bill has **PDF + WhatsApp + Print** buttons (we already have the [A4 PDF](15-bill-templates-and-editor.md); WhatsApp = `wa.me` deep link with the PDF link).
- **Progressive disclosure:** hide GRN, e-invoice, e-way, reports behind a simple menu; the 90% user only sees Sell / Items / Parties / Reports.
- **Mobile-first + PWA install** (already built) — most shopkeepers are on a phone.
- **Regional language** — extend the existing EN/HI i18n; printed bills stay English.

---

## 7. Module map (what a shop gets) + reuse

| Module | myBillBook has | We have (reuse) | New work |
|---|---|---|---|
| Sales invoice (GST) | ✅ | ✅ finalizePakka, tax, numbering | Simplify UI; per-shop scoping |
| Estimate/Quotation | ✅ | ~ kacha slip | Add a proper quotation doc |
| POS / quick bill | ✅ | ✅ PosClient | Simplify to one screen |
| Parties (customers/suppliers) | ✅ + ledger | ✅ Customer, LedgerEntry, Supplier | Bulk import; unify UI |
| Items / inventory | ✅ barcode, MRP | ✅ Product, stock, GRN, batches | Barcode; simplify; bulk import |
| Payments / receipts | ✅ | ✅ Payment, ledger | UI; one-payment-many-invoices |
| Bill templates / print | ✅ themes, thermal/A4 | ✅ plan [15](15-bill-templates-and-editor.md) + A4 PDF | Build the editor (per-shop) |
| Reports (20+) | ✅ | ✅ sales/GSTR-1/valuation/day-end | Package + simplify |
| GST e-invoice / e-way | ✅ (IRN/QR) | ✗ | Integrate GSP/IRP (later, Enterprise tier) |
| WhatsApp/PDF share | ✅ | ✅ PDF; ⨯ WhatsApp | Add WhatsApp/email share |
| Multi-business / users | ✅ | ✗ (single tenant) | **The pivot (§5)** |
| **Platform super-admin** | (their internal) | ✗ | **New (§4a)** |
| **Subscriptions/plans** | ✅ | ✗ | New (billing the shops) |
| Ecommerce storefront | ✗ | ✅ | Keep as optional per-shop add-on [CONFIRM] |

---

## 8. Phased roadmap

Each phase is shippable; we do the plumbing before the polish.

**P0 — Multi-tenant foundation (biggest, do first)** ✅ DONE
- Add `Shop`, `ShopMembership`, `Plan`/`Subscription` models; add `shopId` to every business table; per-shop `StoreConfig` + counters; composite uniqueness per shop.
- Scoped core context (`ctx.shopId` + `forShop()` accessor); refactor all services + pages to require it.
- Migrate the existing single shop into "Shop #1" (data migration).
- *Risk:* large, careful migration — but mechanical. This is the make-or-break slice.

**P1 — Platform super-admin** ✅ DONE
- New realm + app: create/suspend shops, assign owners, set plan/limits, impersonate (audited), usage view.
- Shop provisioning flow (create shop → create owner → seed defaults + starter templates).

**P2 — Shop auth + onboarding + simplicity re-skin** ◑ onboarding wizard + simplicity re-skin DONE; OTP login outstanding
- OTP phone login for shop users; owner→staff invites + roles.
- 3-step onboarding wizard; Excel bulk import (items + parties).
- Rebuild the shop home around **one-screen billing** + the simplicity playbook (§6).

**P3 — Share & templates** ✅ DONE
- WhatsApp/email share of the PDF; build the per-shop **bill editor** (plan 15, now tenant-scoped); thermal/A4 print polish.

**P4 — SaaS business features** ✅ plans/subscriptions/limits DONE (no gateway — operator records payments); per-shop subdomains outstanding
- Subscription enforcement (limits per plan), trials/expiry, per-shop subdomains, billing the shops. *(Self-serve signup deferred — shops are provisioned by the super-admin.)*

**P5 — Advanced GST (Enterprise tier)** ◻ scoped in doc 20; e-way bill built, e-invoicing deferred
- e-invoice (IRN/QR) + e-way bill via a GSP/IRP integration.

---

## 9. Key risks & notes
- **P0 is the hard part.** Getting `shopId` onto every table + scoping every query is where correctness (and cross-tenant data leaks) lives. Enforce it in ONE place (§5c) and add tests that assert a shop can't see another shop's rows.
- **Numbering per shop** must stay gapless per shop — the existing row-lock logic ports directly, keyed by `shopId`.
- **Vercel/Neon cost** scales fine with shared-DB row-level; revisit only at large scale.
- **Don't rebuild the core.** The billing/tax/inventory engine is our moat — evolve, don't throw away.
- **Simplicity is a feature, not a coat of paint** — it drives the data model (defaults on items), auth (OTP), and IA (billing = home).

---

## 10. Strategic decisions

### ✅ Confirmed (owner, 2026-08-01) — these are now locked
1. **Tenancy scope: SaaS for many shops.** You are the platform operator; hardware shops are paying tenants. Full multi-tenant + subscriptions.
2. **Storefront: keep as an optional per-shop add-on.** Each shop can enable/disable the B2C storefront; de-prioritised, not deleted.
3. **Build path: evolve the current codebase.** Reuse the strong billing/tax/inventory core; layer multi-tenancy + simpler UX on top.
4. **Shop creation: super-admin only.** No public self-serve signup — **you provision every shop** from the platform console (create shop → create owner → seed defaults). Simpler auth, no signup-abuse guardrails needed yet. *(Self-serve can come much later; drop it from P4.)*

### ◻ Still open (don't block P0)
5. **Login:** switch shop users to **OTP phone login** (myBillBook-style)? Needs an SMS provider (MSG91/DLT is already referenced in the stack). *Recommended yes — it's core to the simplicity goal.*
6. **Industry breadth:** hardware-only, or a **general retail** billing SaaS? (Affects default catalogs / HSN presets, not the architecture.)
7. **Pricing tiers:** plan shape (e.g. Free/Pro/Enterprise) and what each gates (users, invoices/mo, e-invoice, storefront add-on).
8. **Subdomains:** per-shop subdomains (`myshop.platform.com`) now or later? *(Later — auth-derived tenant works day one.)*

---

## 11. Immediate next steps
1. **Confirm §10 #1–#3** (they gate the whole architecture).
2. Turn **P0** into a detailed migration slice-plan (models + `shopId` rollout + scoped context + data migration of the existing shop).
3. Prototype the **one-screen billing** UX + **OTP login** as the north-star of "simple".

---

### Sources (myBillBook research)
- [myBillBook — GST Billing, Invoicing & Accounting](https://mybillbook.in/)
- [myBillBook FAQs (features, parties, multi-business, plans)](https://mybillbook.in/s/faqs/)
- [How to create a custom invoice in myBillBook (themes + live preview)](https://mybillbook.in/s/how-to-create-custom-invoice-in-mybillbook/)
- [myBillBook Invoicing software (GST & non-GST)](https://mybillbook.in/invoicing-software)
- [Capterra — myBillBook profile](https://www.capterra.com/p/202732/FloBooks/)
