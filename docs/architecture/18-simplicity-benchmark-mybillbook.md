# Simplicity Benchmark — myBillBook vs. Our App

**Date:** 2026-08-01 · **Purpose:** measure *how easy* it is to (a) get products in and (b) make bills in myBillBook vs. our app, to steer the P2 "simple like myBillBook" re-skin ([16](16-saas-platform-base.md) §6). Grounded in web research (myBillBook help docs + reviews) and a line-level audit of our own code. Claims flagged where unverifiable.

---

## 0. Verdict in one line

Our **billing loop is already myBillBook-fast** (~4 taps, walk-in + cash defaults, automatic tax & numbering). We lose badly on **getting products in**, **onboarding**, and **sharing the bill** — and those three are exactly where a shopkeeper's first impression is formed. None of the gaps are in the hard part (the GST engine); they're in the easy part (UX polish), which is good news.

---

## 1. Scorecard

| Dimension | myBillBook | Our app | Who wins |
|---|---|---|---|
| **Make a cash bill** | POS, item-first, ~3 actions | POS, ~4 actions, 1 required field | ≈ **Tie** |
| **Auto tax / numbering** | Yes | Yes (gapless, CGST/SGST/IGST, round-off) | ≈ **Tie** |
| **Share the bill** | 1-tap WhatsApp/email + auto-SMS | Print + manual A4 PDF download only | **myBillBook (big)** |
| **Add one product** | ~2 required (name + price), auto item-code | 17 fields / 5 sections, 4 required, manual SKU | **myBillBook (big)** |
| **HSN / GST on item** | Type name → auto-HSN → auto-GST | Blank HSN, GST hardcoded 18, not remembered | **myBillBook** |
| **Bulk import** | Excel + 1-lakh catalog + Tally/Vyapar/Busy/Marg migration | CSV only, fixed headers, prices in *paise* | **myBillBook (big)** |
| **Barcode** | Scan-to-add + generate/print labels | Placeholder text only (no barcode field) | **myBillBook** |
| **Onboarding** | Add item → bill; ships with default units | No wizard; "masters wall" blocks first product | **myBillBook (big)** |
| **Add item/party mid-bill** | Yes (desktop CTRL+I) | No — must leave the POS | **myBillBook** |
| **Print formats** | A4 / A5 / thermal 2" / 3" | A4 / A5 / thermal 58 / 80 mm | ≈ **Tie** |
| **Invoice themes** | 8 templates + no-code live-preview editor | Fixed templates, no editor | **myBillBook** |
| **Reports** | 20+ (GSTR-1/2/3B, P&L, HSN…) | 4 + operational views | **myBillBook** |
| **e-invoice / e-way** | Yes (top tier) | None (planned P5) | **myBillBook** |
| **GST correctness of core** | Good (some reviewers report calc errors) | Strong, tested (gapless per-shop series) | ≈ **Us** |
| **Languages** | 5 (EN/Hinglish/Hindi/Gujarati/Tamil) | 2 (EN/Hindi), instant toggle | **myBillBook** |
| **Mobile** | Android/iOS/web/desktop + sync | Installable PWA, real mobile layouts | ≈ **Tie** |
| **Pricing feel** | ₹291–570/mo; reviewers cite price-creep & paywalls | We set it (chance to undercut, no creep) | **Opportunity** |

---

## 2. Deep dive — getting PRODUCTS in

### 2a. Add one product (manual)

| | myBillBook | Our app |
|---|---|---|
| Minimum to save | **Name + Sale Price** (stock optional) | **Name + SKU + Category + Sale Price** (+ must pick a Unit) |
| Total fields on form | ~15, nearly all optional, one screen | **17 across 5 sections** (`ProductForm.tsx:96-407`) |
| Item code / SKU | **Auto-generated** | **Manual, must be unique** → `DUP_SKU` error (`schema.ts:52`, `actions.ts:53`) |
| HSN code | Type item name → **"Find HSN Code"** → pick | **Blank every time**, typed by hand (`ProductForm.tsx:193`) |
| GST rate | **Auto-fills from chosen HSN**, else dropdown | **Hardcoded 18**, not remembered / not per-category (`ProductForm.tsx:197`) |
| Units | Ships with kg/pcs/box…, + optional alternate-unit ratio | **Must create units first** or the form is blocked; UoM-factor sub-form (`new/page.tsx:46-55`, `ProductForm.tsx:270-384`) |
| Wholesale / bulk price | Toggle on + min-qty, auto-applies on bill | **Price slabs on a separate edit page**, not at create (`PriceSlabEditor.tsx`) |
| Clicks (best case) | ~6 | ~6 *if* a unit & category already exist; otherwise a detour first |

**Why myBillBook feels easier:** the required set is tiny (name + price), the item-code is automatic, and the single biggest knowledge barrier — the HSN code — is solved by a **name search that also auto-sets the GST rate** ([myBillBook HSN/GST help](https://knowledge.mybillbook.in/articles/0676534-how-to-add-hsn-code-and-gst-details-for-items)). Our form asks for a hand-typed unique SKU, a category that may not exist yet, and re-asks HSN/GST on every item.

### 2b. Bulk import

| | myBillBook | Our app |
|---|---|---|
| Formats | **Excel .xlsx**, header order flexible | **CSV only**, fixed header names (`import/service.ts:100-133`) |
| Template | Implied downloadable template | **None** — columns shown as inline chips only (`import/page.tsx`) |
| Prices | Rupees | **Must be pre-converted to paise** — ₹250 → `25000` (`schema.ts:200-202`) |
| Competitor migration | **Tally / Vyapar / Busy / Marg** export→import | **None** |
| Head start | **Inbuilt 100 000+ product library** + Bulk Edit | None |
| Column mapping | Header-based (any order) | None — exact header match or the row fails |

**This is our weakest area for day-1.** A shopkeeper switching from Vyapar or a spreadsheet can populate myBillBook in minutes; with us they'd hand-fix headers and convert every price to paise. (Sources: [myBillBook bulk-add](https://knowledge.mybillbook.in/en/articles/0441947-how-to-add-items-in-bulk-using-mybillbook), [inventory page](https://mybillbook.in/inventory-management-software).)

### 2c. Barcode
- **myBillBook:** USB scan-to-add on the bill; per-item + bulk **barcode generation**; label printing (48/A4 sheet); paid (Diamond) tier ([barcode page](https://mybillbook.in/s/billing-software-with-barcode/)).
- **Ours:** the POS placeholder says "scan barcode," but there is **no barcode field on a product** and no scan handler — a USB scanner only works incidentally by typing the SKU (`schema.ts:51-69`, `billing.json:17`).

---

## 3. Deep dive — making BILLS

**Good news: this is our strongest flow and it's genuinely competitive.**

| | myBillBook (POS) | Our app (POS) |
|---|---|---|
| Default customer | Optional (walk-in) | **Walk-in default** (`PosClient.tsx:178`) |
| Add item | Search name/barcode/category → qty | Search name/SKU → **Enter adds top match**, qty=1 (`PosClient.tsx:260-291`) |
| Tax / totals | Auto CGST/SGST, round-off | **Auto**, live preview (`PosClient.tsx:294-314`) |
| Invoice number | Automatic | **Automatic, gapless, per-shop** (`finalizePakkaAction`) |
| Payment | Defaults implied | **Defaults to CASH**, amount optional (`PosClient.tsx:180`) |
| Minimal cash sale | ~3 actions | **~4 actions, 1 required field** (a product line) |
| One screen, no modals | Yes | **Yes** (`PosClient.tsx:449-1058`) |

**Two real gaps in the loop:**
1. **No inline "add new item / new customer"** — our search only lists existing products, and the party picker can't create one, so a credit sale to a new customer forces a detour to the Ledger section (`PosClient.tsx:512-536`, `PosCustomerPicker.tsx`). myBillBook lets you create an item mid-bill (desktop **CTRL+I**).
2. **No "hold bill"** — myBillBook can juggle up to 5 open bills at a busy counter.

### 3b. Sharing the bill — **our single biggest gap**
- **myBillBook:** **one-tap WhatsApp / email**, an **automatic SMS with a bill link on every invoice**, plus A4/A5/thermal print ([invoice-generator](https://mybillbook.in/s/invoice-generator/), [FAQs](https://mybillbook.in/s/faqs/)).
- **Ours:** `window.print()` + a **manual A4 PDF download opened in a new tab from the invoice detail page** — and **zero** WhatsApp/SMS/email (grep for `whatsapp|wa.me|navigator.share|mailto` = no hits) (`PosClient.tsx:1036`, `invoices/[id]/page.tsx:127-132`). For Indian shopkeepers, "send bill on WhatsApp" *is* the modern receipt — this is the most visible thing we're missing.

---

## 4. Other features (breadth)

| Area | myBillBook | Our app |
|---|---|---|
| Document types | Quotation, proforma, challan, PO, credit/debit note, receipt | Pakka + Kacha invoice, credit note |
| Payment across many invoices | Yes (one receipt → 3 bills) | Ledger/khata + payments (single-invoice oriented) |
| Reports | 20+ (GSTR-1/2/3B, P&L, balance sheet, HSN, stock) | 4 (day-end, sales, GSTR-1, valuation) + operational views |
| e-invoice (IRN/QR) / e-way | Yes (top tier) | None (planned P5) |
| Invoice themes | 8 + no-code live-preview editor (AI styling) | Fixed A4/thermal templates |
| Platforms | Android + iOS + web + desktop, cloud sync | Web + **installable PWA**, real mobile layouts |
| Offline | Partial (desktop-leaning) | None (all finalize = server) |
| Languages | 5 (EN/Hinglish/Hindi/Gujarati/Tamil) | 2 (EN/Hindi), **instant no-reload toggle** |
| Low-stock alerts | Yes | **Yes** (per-shop cron) |

---

## 5. Where WE are already good (don't lose these)

- **The POS billing loop** — parity with myBillBook on speed and defaults.
- **A correct, tested GST core** — gapless per-shop invoice series, CGST/SGST-vs-IGST by place of supply, credit notes, khata. Some myBillBook reviewers report **calculation errors and settings resetting after updates** ([Capterra](https://www.capterra.com/p/202732/FloBooks/)); correctness is a real differentiator we can lean on.
- **Thermal + A4 print already built** (58/80 mm/A5/A4).
- **Full Hindi** with an instant toggle (no reload).
- **Real mobile PWA** — installable, thumb-friendly layouts.
- **We own pricing** — myBillBook reviewers repeatedly complain about **rising fees and paywalled features** ([Capterra](https://www.capterra.com/p/202732/FloBooks/), [Techjockey](https://www.techjockey.com/reviews/mybillbook-accounting-software)). A simpler, cheaper, no-creep plan is an opening.

---

## 6. The gap list → P2 backlog (ranked by impact ÷ effort)

| # | Fix | Impact | Effort | Notes |
|---|---|---|---|---|
| 1 | **One-tap WhatsApp share** of the bill | 🔥 High | Low | `wa.me/<phone>?text=…` + the existing PDF link; add to POS result + invoice page |
| 2 | **Onboarding: seed default units/categories + kill the masters wall** | 🔥 High | Low-Med | Ship PCS/KG/BOX/BAG/METRE + a few categories; let "Add product" work immediately |
| 3 | **Simplify Add-Product** (progressive disclosure) | 🔥 High | Med | Show only name + price + GST; auto-generate SKU; remember last GST / per-category; hide UoM factor unless needed |
| 4 | **Inline add item + add customer inside the POS** | High | Med | Quick-add modal; removes the only real detour in billing |
| 5 | **Better import** — Excel, template download, **rupees not paise**, header mapping | High | Med | Also add a Vyapar/Tally CSV adapter later |
| 6 | **HSN name-search → auto-GST** | Med-High | Med-High | Needs an HSN dataset; kills the biggest tax barrier |
| 7 | **Real barcode** — a product barcode field + scan-to-add + label print | Med | Med | Scanner-first; camera scan later |
| 8 | **First-run wizard** (shop details → add a few items → first bill) | Med | Med | Ties 2/3/5 together |
| 9 | More languages (Hinglish/Gujarati/Tamil); e-invoice/e-way | Med | High | Later / Enterprise tier (P5) |

**Recommended first sprint (the "feels like myBillBook" starter):** #1 (WhatsApp) + #2 (default units / no masters wall) + #3 (simple product form). All low-to-medium effort, and together they fix the three worst first-impression moments — the empty catalog, the heavy product form, and the un-shareable bill.

---

## 7. Sources
myBillBook: [POS billing help](https://knowledge.mybillbook.in/articles/8679710-how-to-use-pos-billing-in-mybillbook-web-app) · [create a sales invoice](https://knowledge.mybillbook.in/articles/4281361-how-to-create-a-sales-invoice-on-mybillbook) · [GST bill](https://knowledge.mybillbook.in/articles/5367766-how-to-create-a-gst-bill-using-mybillbook) · [add/manage inventory](https://knowledge.mybillbook.in/articles/4381436-how-to-add-and-manage-inventory-in-mybillbook) · [HSN & GST](https://knowledge.mybillbook.in/articles/0676534-how-to-add-hsn-code-and-gst-details-for-items) · [bulk add items](https://knowledge.mybillbook.in/en/articles/0441947-how-to-add-items-in-bulk-using-mybillbook) · [barcode](https://mybillbook.in/s/billing-software-with-barcode/) · [invoice customization](https://mybillbook.in/s/features/invoice-customization/) · [pricing](https://mybillbook.in/pricing-plans) · reviews: [Capterra](https://www.capterra.com/p/202732/FloBooks/), [Techjockey](https://www.techjockey.com/reviews/mybillbook-accounting-software), [SoftwareSuggest](https://www.softwaresuggest.com/mybillbook/reviews).
Our app: line-level audit of `apps/admin/app/(admin)/catalog/ProductForm.tsx`, `billing/PosClient.tsx`, `packages/core/src/{catalog,billing,import}`.

**Flagged / unverified:** myBillBook's exact minimal tap count (not published; ~3 POS actions inferred), whether it remembers last-used GST%, exact free/paid gating of bulk import, and mobile camera-scan / mobile inline quick-add (docs emphasize USB scanner + desktop CTRL+I).
