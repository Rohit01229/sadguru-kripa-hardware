# myBillBook Parity — Build Plan

**Status:** in progress · **Date:** 2026-08-03
**Directive:** make the shop-owner flows **as close to myBillBook as possible** — same screen order, same field labels, same affordances. Familiarity is the feature; "ours is cleaner" is not a reason to deviate.
**Driven by:** the measured gap analysis in [18](18-simplicity-benchmark-mybillbook.md).

---

## 1. Scope

The nine parity items, in the order the user listed them:

| # | Item | Status |
|---|---|---|
| 1 | Add product (simple, ~2 required fields) | ✅ Done |
| 2 | HSN / GST automation ("Find HSN Code") | ✅ Done |
| 3 | Onboarding — no masters wall, default units | ✅ Done |
| 4 | Barcode (field + scan-to-add + labels) | ✅ Done (camera scan still open — see §12) |
| 5 | Bulk import (Excel, template, rupees) | ✅ Done |
| 6 | Add item / party mid-bill | ✅ Done |
| 7 | Invoice themes (no-code editor) | ✅ Done (v1 — see §10) |
| 8 | Reports (breadth toward 20+) | ✅ Done (4 → 8 core reports; see §11) |
| 9 | e-invoice (IRN/QR) + e-way bill | ◑ **e-way bill DONE**; e-invoicing scoped &amp; deferred (not legally required below ₹5cr) — see [20](20-einvoice-eway-scope.md) |
| + | **One-tap WhatsApp share** (doc 18's #1 gap) | ✅ Done |
| + | **Estimate / Proforma / Delivery challan** + convert-to-bill | ✅ Done — see [21](21-presale-documents.md) |
| + | **Expenses** (categories, GST split, month breakdown) | ✅ Done — see [21b](21b-expenses.md) |
| + | **Purchase orders** + receive-into-GRN, incl. **partial receipt** | ✅ Done — see [21c](21c-purchase-orders.md) |

---

## 2. Add an item — the quick form

**myBillBook's rule: Item Name + Selling Price is a complete item.** Everything else is optional and hidden behind one "Add more details" toggle.

**Terminology (mirrored exactly — never our internal names):**

| myBillBook | our old label | now |
|---|---|---|
| Item Name | Name | **Item Name** |
| Item Code | SKU | **Item Code** (placeholder "Auto-generated") |
| Selling Price | Sale price | **Selling Price** |
| Purchase Price | Cost per base unit | **Purchase Price** |
| MRP | MRP | MRP |
| Wholesale Price + Minimum Wholesale Quantity | (price slabs, separate page) | **on the item form** |
| Opening Stock | (separate stock adjustment) | **on the item form** |
| HSN/SAC Code | HSN code | **HSN/SAC Code** |
| GST Tax Rate | GST rate % | **GST Tax Rate** |

**What the server fills in so the form can stay short** (`packages/core/src/catalog/`):
- **Auto Item Code** — `generateSku()` derives a per-shop prefix from the name (`ULTRAT-0001`) and retries on a race.
- **Default masters** — `defaults.ts` seeds a hardware unit set (PCS, BOX, BAG, KG, M, …) + a "General" category **on first use**, so a brand-new shop is never sent to a set-up screen. Seeds only when the master is empty, so a curated catalog is never touched.
- **Sale unit** — SIMPLE mode synthesises one sale unit at the base unit, factor 1, at `salePrice`.
- **Last-used GST** — `getLastUsedGstRate()` pre-fills the rate from the shop's most recent item instead of a hardcoded 18.
- **Wholesale → PriceSlab** — "Wholesale Price + Minimum Wholesale Quantity" is stored as ONE price slab on the default sale unit, so the existing (tested) pricing resolver applies it at billing time with no billing change.
- **Opening Stock** — posted through the stock kernel as an `ADJUST_IN` movement, so it is auditable like any other stock change.

Both entry modes share **one** Zod schema and **one** service: the FULL form (multiple sale units + conversion factors) still parses exactly as before and now lives at `/catalog/new/detailed`, linked from the quick form. Nothing was removed.

**Save + Save & New** — matching myBillBook's rapid catalog entry.

---

## 3. HSN & GST — "Find HSN Code"

myBillBook's key trick: the shopkeeper types the **item name**, presses **Find HSN Code**, picks from a list, and the **GST rate fills in with it**. That removes the single biggest knowledge barrier.

Ours (`packages/core/src/catalog/hsn.ts` + `GET /api/hsn?q=`):
- A curated, **offline** dataset of the ~65 HSN headings a hardware store actually bills (4-digit — what a small shop needs on an invoice).
- Ranked search over keywords, including **Hindi-English shop vernacular**: `sariya` → 7213 (TMT bars), `tala` → 8301 (locks), `kabza` → 8302 (hinges), `gitti` → 2517 (aggregate).
- Matches inside a real item name — "UltraTech PPC Cement 50 kg" → **2523 @ 18%**.
- **Returns nothing rather than guessing.** A wrong-but-plausible classification is worse than a blank HSN, which is a valid invoice for a small shop.
- The rate is presented as a **suggestion the shopkeeper can overwrite**, with a "confirm with your accountant" note — HSN classification depends on the exact good, and rates move with GST notifications.

---

## 4. Onboarding — the masters wall is gone

Previously `/catalog/new` was **replaced** by an empty state if the shop had no units or categories, forcing a trip to the Masters screen before the first item ever existed. Now the page seeds the starter masters on demand (idempotent) and renders the form. `createProduct` performs the same back-fill server-side, so the API path is equally unblocked.

---

## 4b. Barcode at the till

`Product.barcode` is a nullable, indexed, **non-unique** column (two shop SKUs can share an EAN). It is returned in the product DTO and matched **exactly** in product search — a `contains` match on a 13-digit EAN would drag in unrelated items that merely share a run of digits. An exact barcode hit is floated to the top of the POS results, so the Enter a scanner sends automatically always rings up the scanned item.

Rescanning the same item now **increments the quantity** instead of stacking a duplicate line — what every till does. It only merges into a *plain* line: once the operator has overridden the rate or applied a line discount, that line is bespoke and is left alone.

USB/Bluetooth scanners work today (they are keyboard devices — they type the code and press Enter). **Camera scanning and barcode-label printing are still to do.**

## 5. Share the bill

`billing/share.ts` builds a `wa.me` deep link carrying a formatted text receipt (shop, bill no, date, item lines, total). Available on the POS the moment a sale is finalised **and** on any past invoice's detail page (the "can you send that again?" case). Phone numbers are normalised to `91XXXXXXXXXX`; with no phone on file the link opens WhatsApp's contact picker, which is the right behaviour for a walk-in.

**Honest scope:** a browser cannot attach a generated PDF to WhatsApp, so we send a *text* receipt and keep "Download PDF" beside it for the formal tax invoice. Auto-attaching the PDF needs the WhatsApp Business API (paid, per-message) — a deliberate later decision, not something to fake. An `sms:` builder is included for customers not on WhatsApp.

## 6. Quick-add inside the bill

Neither a new customer nor a new item now forces the operator out of the till:
- **Party** — when the customer search finds nothing, the dropdown offers "Add *…* as a new customer" with name + phone inline; on save it is selected onto the bill immediately.
- **Item** — when the product search finds nothing, it offers "Add *…* as a new item" with name + selling price; on save the item is created and **dropped straight into the cart**.

Both go through the same permission-guarded, audited core services as the full forms — quick entry changes the UI, never the rules. The item path reuses the SIMPLE create, so the server still back-fills the item code, unit and category.

## 9. Bulk import

The old importer was the least forgiving thing in the app: CSV only, exact header names, **prices in paise** (₹250 had to be typed `25000`), and eight mandatory columns. Someone moving off a spreadsheet had to rewrite their file before it would load. All four are fixed:

- **Rupees, as typed.** `250`, `250.50`, `₹1,250.75` all work — the schema strips `₹`/commas and converts once, at the edge. This was the single most spreadsheet-hostile thing about the old importer.
- **Only Item Name + Selling Price are required.** Everything else is optional and back-filled by the *same* `createProduct` the quick form uses, so an imported item and a hand-typed one are identical — auto item code, default unit/category, opening stock as an audited `ADJUST_IN`, wholesale price as a slab.
- **Headers are matched by synonym, in any order.** Normalised (case/space/punctuation-insensitive) against an alias table, so "Item Name", `item_name`, "Particulars" and "Product Name" all resolve — as do "Rate"/"Selling Price", "Purchase Price"/"Cost", "HSN/SAC"/`hsn_code`. A sheet missing a name or price column fails **once, with a clear message**, instead of repeating the same error on every row.
- **Excel (.xlsx) uploads directly**, no "Save As CSV" step. `import/xlsx.ts` is a dependency-free reader: an .xlsx is a ZIP of XML, so it parses the central directory, inflates parts with the platform's `DecompressionStream("deflate-raw")`, and reads `sharedStrings` + the first worksheet. Format is sniffed from the bytes, so a mislabelled upload still works. Scope is deliberately narrow (first sheet, cached formula values, size-capped) and anything unparseable throws a visible row-0 error rather than importing silently.
- **A downloadable template** (`GET /api/import/template`) with the right headings and two worked example rows, UTF-8 BOM so Excel opens ₹/Hindi correctly. A test asserts every column the template advertises is one the importer actually understands, and that its example rows validate — the template can't drift from the parser.

**Bug found and fixed while verifying:** with no category column, an item was filed under the shop's alphabetically-first existing category — a door hinge landed in "Cement & Concrete". `ensureDefaultMasters` now find-or-**creates** the "General" bucket instead of picking an arbitrary row. Same for the default unit.

## 10. Invoice themes

myBillBook gives a business preset themes plus **one** customisable template — not a template library — so that is the shape built here: a per-shop `billTheme` JSON on `StoreConfig`, five starter looks (Classic, Modern, Compact, Formal, Minimal), and a live-preview editor at **Settings → Bill theme**.

**Controls:** accent, font, text size, spacing, table lines, header alignment, zebra rows, outer border; toggles for logo, address, phone, HSN column, bank details, terms, signature and footer note; and free-text tagline / signature label / footer note with `{{shop.name}}`-style tokens.

**The preview is the real renderer.** The editor mounts the same `InvoicePrint` component that prints, fed fixed sample data — so preview genuinely equals print, and there is no second implementation to drift (plan 15 §1). The theme applies to the POS receipt, invoice reprints, **and** the downloaded A4 PDF; a theme that only worked on screen would be a broken promise.

**Compliance is structural, not a rule.** The config can hold only closed enums, clamped numbers and short plain text — no colour string, no CSS, no HTML. And there is deliberately **no key** for GSTIN, the CGST/SGST-vs-IGST breakup, amount in words or the invoice number, so no theme (or tampered payload) can produce a non-compliant tax invoice. Thermal paper additionally overrides font/size/borders it cannot physically honour. A test asserts those forbidden keys stay absent.

**Two things found while building:**
- Dropped the planned MRP and unit columns: `InvoiceLine` snapshots neither, and a switch that silently does nothing is worse than no switch.
- **Bug fixed:** token substitution used a plain object lookup, so `{{constructor}}` resolved up the prototype chain and would have printed `function Object() { [native code] }` onto a customer's invoice. Now a `Map`, with a regression test over `constructor`/`toString`/`valueOf`/`__proto__`.

Deferred to plan 15's fuller model: multiple saved templates per paper size/doc type, section reordering, and the QR/UPI block.

## 11. Reports

We had **4** reports (day-end, sales, GSTR-1, stock valuation) against myBillBook's 20+. Rather than pad the count, the gap was closed where a hardware shop actually feels it — the four questions the old set could not answer at all:

| Report | Answers | Grouped by |
|---|---|---|
| **Purchases** | "What did I spend, and with whom?" | day · supplier · item |
| **Receivables** | "Who owes me, and for how long?" | party, biggest first, 0–30 / 31–60 / 60+ buckets |
| **Collections** | "What came in this week?" | day · payment mode |
| **Sales returns** | "What came back, and why?" | credit note, with reason + refund route |

**Purchases** reads the goods-receipt trail (`GoodsReceipt`/`GrnLine` × cost) — the buying side had no reporting at all, though the data was there. **Receivables** reuses the already-tested `ledger.aging` per customer rather than re-deriving buckets; it is ordered largest-first because it is a call sheet, not a directory, and 60+ day debt is badged so it stands out. **Collections** extends day-end from one day to a range, which is what reconciling against a cash box or bank statement needs. **Sales returns** lists credit notes with their reason and refund mode.

Each page reuses one shared `RangeFilterBar` (a generalisation of the sales filter, keeping the no-reload soft-navigation and the no-JS `method="get"` fallback), so a fifth report costs a page, not a copy.

**Deliberately NOT built: bill-wise profit.** `InvoiceLine` does not snapshot cost at the time of sale, so profit could only be computed against *today's* purchase price — which would be quietly wrong for any item whose cost has moved, exactly the items an owner would examine. Doing it properly means stamping `costAtSale` onto the line at finalize time, and it can only ever be right for sales made after that ships. Recommended as the next reporting slice, with the limitation stated rather than shipped silently.

## 12. Barcode label printing

**Symbology: Code 39, chosen deliberately.** Every handheld scanner reads it with no configuration, and it is *self-checking* — each character carries its own structure, so a smudged or misprinted bar fails to decode rather than decoding as something else. On a shop label that property is the whole point: a barcode that silently scans as the wrong item puts the wrong price on a bill. Its table is also 44 entries, small enough to hold correct and to verify exhaustively, where Code 128's 107 entries are easy to get subtly wrong — and wrong means unscannable stock.

*Trade-off, stated plainly:* Code 39 carries only 0-9, A-Z and a few symbols and is less dense than Code 128. Our item codes are short and uppercase-alphanumeric by construction (`ULTRAT-0001`), so this costs nothing today; EAN-13 or Code 128 can be added alongside if a shop ever needs a true retail GTIN — the renderer is symbology-agnostic.

**No dependency.** `catalog/barcode.ts` emits plain SVG: it prints crisply at any size, needs no canvas, font or runtime library, and adds nothing to the Vercel bundle. Quiet zones (10 narrow widths a side) are included — omitting them is the most common reason a printed label reads intermittently.

**Verification without a physical scanner.** Two layers:
1. *Structural* — Code 39's defining invariant is that every character is nine elements of which exactly three are wide. A per-character test asserts it, so any transcription slip in the table fails immediately. Patterns are also checked to be mutually unique (no two characters can decode alike).
2. *Round-trip* — an **independent decoder**, written from the spec and sharing no code with the encoder, measures the rendered bars, classifies wide vs narrow, and reads the text back. Every character and a set of realistic item codes encode → render → decode to exactly the original string.

**Sheet geometry is in millimetres, not pixels.** Label stock is a physical product, so the grid must land on the die-cuts regardless of screen DPI or browser zoom; `@page` fixes the paper size and removes the browser's default margins, which would otherwise shift every label. Three stocks ship: A4 48-up, A4 24-up, and a 2-across roll.

**Bug caught while building:** the sheet spec was first written as 48 labels at 52.5 × 25 mm — but twelve 25 mm rows is 300 mm, which does not fit A4's 297 mm, so every sheet would have lost its bottom row. The geometry now follows real label stock (45.7 × 21.2 mm), and a test asserts each sheet fits inside its own page.

Labels encode the item's barcode when set and its Item Code otherwise, so a shop that has never touched the barcode field can still print useful labels — and either value resolves back through POS search. **Camera-based scanning on a phone remains open;** USB/Bluetooth scanners already work, since they are keyboard devices.

## 7. Verification

- All 8 workspace packages typecheck (the contract schema makes the compiler prove every write is shop-scoped).
- **296 core unit tests** pass, including SIMPLE-mode creation, opening stock, barcode, the wholesale slab, auto-SKU generation, the default unit set, 10 HSN-search tests, and 19 import tests (header synonyms, rupee parsing, and a real ZIP-container `.xlsx` round-trip built in the test itself).
- **Barcode labels verified by round-trip decode** (every Code 39 character and realistic item codes read back exactly), and `/catalog/labels` renders 200 with mm-based sheet geometry.
- **New reports verified end-to-end against the live DB**: a seeded goods receipt (10 × ₹425.50) and a ₹1,500.25 UPI payment appeared as exactly ₹4,255.00 under the supplier and ₹1,500.25 under UPI; all 8 report pages return 200; the seeded rows were removed afterwards.
- **Bill theme verified end-to-end against the live DB**: a saved theme (amber / serif / 12pt / boxed / HSN column off) rendered correctly in the live preview with its `{{shop.name}}` tagline token expanded; the shop's theme was restored to defaults afterwards.
- **Import verified end-to-end against the live DB**: a genuine deflate-compressed `.xlsx` with awkward headers ("Particulars", "Rate", "HSN/SAC") imported cleanly — auto item codes, `45.5` preserved as ₹45.50, unit and category defaulted, opening stock posted. Test rows removed afterwards.
- Migration `20260803090000_product_barcode` applied to the live DB; zero schema drift.
- `/catalog/new` and `/billing` both render 200 with the mirrored labels and the new share/quick-add controls; `GET /api/hsn` returns correct headings for real item names.
- WhatsApp link-building verified directly (phone normalisation for 10-digit / spaced / `+91` forms; message body; URL length well inside the deep-link limit).

**Not verified visually.** The Browser pane would not composite frames during this work, so the UI was checked through rendered HTML and typechecks rather than screenshots. Worth a human look at `/catalog/new` and `/billing`.

---

## 8. Open decisions
- **GST rates in the HSN dataset** are the commonly-applied ones and are labelled as suggestions. If we want authoritative rates we need a maintained source (a GSP/rate API) — worth doing before we market this as compliance.
- **Barcode scanning** — USB scanners work as keyboard input today (they type the code + Enter). A camera scan on mobile is a separate piece of work.
