# Bill Formats & No-Code Bill Editor — Implementation Plan

**Project:** Sadguru Kripa Hardware (admin app)
**Scope:** (1) Multiple selectable bill formats — thermal 58/80mm receipts + A5/A4 tax invoices, for both KACHA and PAKKA; (2) a no-code, live-preview "bill editor" a non-technical shop owner can use, without breaking GST compliance or gapless numbering.

_Produced by a multi-agent planning pass (understand codebase → research → design → synthesize)._

---

## 0. Confirmed scope (owner, 2026-07-26)

- **Hardware: BOTH** a thermal receipt printer (58/80mm) **and** an A4 inkjet/laser. → prioritise the full catalog (all 6 starters).
- **PDF: YES** — bills must be downloadable **and** emailable. → S7 (server PDF) is IN scope. Download can start free via the browser's "Save as PDF"; **emailable** PDF needs the server route. Recommended engine: **`@react-pdf/renderer` (Hobby-safe, free)** as the default, or **Vercel Pro + puppeteer** if pixel-identical-to-print fidelity is required (see §6 / decision #1).
- **B2B: YES** — formal / inter-state invoices matter. → S8 (recipient address + GST state code + ORIGINAL/DUPLICATE/TRIPLICATE copies + reverse-charge flag) is IN scope.

Net delivery target: **S1–S8** (S9 HTML-snippet escape hatch remains optional/deferred).

---

## 1. Recommendation

**Build Approach A (structured section/config editor) as the core, seeded with curated starter templates (the strongest idea from Hybrid C). Defer the header/footer HTML-snippet "escape hatch" to an optional late slice, and reject the drag-and-drop canvas (Approach B).**

### Why A over B and C

| | A — Config form | B — Drag canvas | C — Config + HTML snippet |
|---|---|---|---|
| Usability for a non-technical shopkeeper | **Highest** — familiar form pattern, no spatial reasoning, touch-friendly on cheap tablets | Deceptively bad — blank-canvas paralysis, fiddly touch drag | High (same as A) |
| Flexibility | Medium — enough for ~95% of real needs | Highest, most of it unwanted | High (A + free header/footer) |
| Build effort / risk | **Lowest** — reuses SettingsForm, @hardware/ui, print isolation; no heavy deps | **XL** — needs dnd-kit, undo/redo, inline edit, per-block drawers | L — A plus a maintained HTML sanitizer (a real, ongoing XSS burden) |
| GST compliance | **Safe by construction** — every value is a typed enum or escaped text; mandatory fields locked | Free reordering can drag the tax breakup off a slip; needs heavy fencing | Safe (snippet physically scoped away from tax content) |
| Injection safety | **Maximal** — arbitrary HTML/CSS/JS is unrepresentable | Same as A if strictly enumerated | The one surface with `dangerouslySetInnerHTML` — must be sanitized + fuzzed |

The decisive constraint is that a PAKKA bill is a **legally-structured GST tax invoice (CGST Rule 46)**. The editor's job is to *theme and toggle optional elements while locking mandatory ones* — a job a structured form does perfectly and a free canvas actively fights. B's "what you see is what prints" promise also can't be kept honestly across 58mm→210mm from one canvas.

We fold in C's best idea — **curated starter templates cloned into editable rows, so the owner never faces a blank canvas** — and keep C's snippet layer on the shelf as an optional future slice if the owner ever needs custom promo/footer wording.

### Load-bearing design principle: one isomorphic renderer

A single `<BillRenderer config data branding paperProfile />` drives the **editor live preview, on-screen `window.print()`, and any server PDF**. Preview literally equals print. This is the only honest basis for WYSIWYG and it eliminates a whole class of drift bugs.

---

## 2. Data Model

Additive migration; no breaking change to existing tables. New model plus three nullable columns on the existing `StoreConfig` "default" row.

```prisma
enum BillDocType  { PAKKA KACHA }
enum BillPaper    { THERMAL_58 THERMAL_80 A5 A4 }

model BillTemplate {
  id            String      @id @default(cuid())
  name          String                          // owner-facing, e.g. "Counter receipt 80mm"
  docType       BillDocType
  paper         BillPaper
  config        Json                             // TemplateConfig (Zod-validated, see §3)
  presetKey     String                           // starter it was cloned from → enables "Reset to starter"
  isPreset      Boolean     @default(false)      // seeded built-ins: duplicate-to-edit
  isArchived    Boolean     @default(false)
  schemaVer     Int         @default(1)          // forward-migrate old configs
  createdById   String?
  updatedById   String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  @@index([docType, paper])
}

// added to model StoreConfig (the single "default" row)
// defaultPakkaTemplateId String?
// defaultKachaTemplateId String?
// upiVpa                  String?   // optional, for a self-contained scan-to-pay QR (display-only)
```

**Design choices**

- **Layout is presentation-only JSON.** Branding (name/gstin/address/logo/bank/T&C) is **not copied into config** — it is referenced at render time from `StoreConfig`, the single source of truth. Config only decides *what shows, in what order, how styled*.
- **Default selection** is stored as pointers on `StoreConfig` (avoids a partial-unique-index dance and drift). The write service resolves print-time: explicit choice → `StoreConfig.default{Pakka,Kacha}TemplateId` → seeded preset fallback.
- **Config never carries raw HTML/CSS/class/expression strings** — only closed enums, clamped numbers, and plain text. This makes it structurally incapable of carrying an injection payload.
- **`logoKey` is repurposed** to a Cloudinary `secure_url` (store-wide). Per-template you only toggle logo *visibility/position*, not a per-template image.

**Validation & writes** live once in `@hardware/core`, mirroring the proven settings pipeline exactly (`packages/core/src/settings/service.ts:89`):

- `billTemplateConfigSchema` (Zod) — validates shape, clamps numbers, restricts enums.
- `assertCompliantLockSet(docType, config)` — server-side GST guard; rejects a PAKKA config missing any locked section/column, and a KACHA config that contains tax columns / invoice-number token.
- `upsertBillTemplate(input, ctx)` — `requirePermission('settings.write')` → one `runTx` → load before-snapshot → validate → `assertCompliantLockSet` → write → `audit(before, after, changedKeys)`.

Gapless numbering (`InvoiceCounter`, `formatInvoiceNo`) and tax math (`finalizePakka`, `computeInvoiceTotals`) are **untouched**. Templates only *display* `invoice.invoiceNo` and pre-computed paise.

---

## 3. JSON Template-Config Schema

One `TemplateConfig` per `BillTemplate.config`. Every `section.type` and `column.key` is a **closed enum**. `locked:true` sections/columns can be reordered and restyled but never disabled — enforced client-side **and** re-asserted server-side.

```jsonc
{
  "schemaVersion": 1,
  "docType": "PAKKA",                 // "PAKKA" | "KACHA"
  "paper": "A4",                      // "THERMAL_58" | "THERMAL_80" | "A5" | "A4"
  "page": { "marginsMm": {"top":12,"right":12,"bottom":12,"left":12}, "outerBorder": true },
  "theme": {
    "fontFamily": "sans",            // "sans" | "serif" | "mono"  (mono FORCED on thermal)
    "baseSizePt": 10,                // clamp 7..14
    "headingScale": 1.6,             // clamp 1.0..2.2
    "accent": "espresso",            // brand tokens ONLY: espresso|amber|kraft|ink|none
    "density": "comfortable",        // "compact" | "comfortable"
    "tableBorders": "ruled",         // "ruled" | "minimal" | "boxed"
    "zebraRows": false
  },
  "copies": { "enabled": true, "labels": ["ORIGINAL FOR RECIPIENT","DUPLICATE FOR TRANSPORTER","TRIPLICATE FOR SUPPLIER"] },
  "sections": [
    { "type":"header", "enabled":true, "locked":false, "order":0, "options":{
        "showLogo":true, "logoPosition":"left", "showShopName":true, "showAddress":true,
        "showGstin":true,                       // LOCKED true for PAKKA
        "showContact":true, "align":"center",
        "tagline":"Quality hardware since 1998" } },      // free text, token-substituted, ESCAPED
    { "type":"docTitle",    "enabled":true, "locked":true,  "order":1, "options":{ "text":"TAX INVOICE", "showCopyLabel":true } },
    { "type":"invoiceMeta", "enabled":true, "locked":true,  "order":2, "options":{ "fields":["invoiceNo","date","placeOfSupply","reverseCharge"], "layout":"two-column" } },
    { "type":"billTo",      "enabled":true, "locked":true,  "order":3, "options":{ "showCustomerGstin":true, "showAddress":true, "showPhone":true } },
    { "type":"lineTable",   "enabled":true, "locked":true,  "order":4, "options":{ "columns":[
        {"key":"sno",       "enabled":true,  "label":"#",       "align":"right","widthPct":5},
        {"key":"itemName",  "enabled":true,  "label":"Item",    "align":"left", "widthPct":30},
        {"key":"hsn",       "enabled":true,  "label":"HSN",     "align":"left", "widthPct":9,  "locked":true},
        {"key":"qty",       "enabled":true,  "label":"Qty",     "align":"right","widthPct":8},
        {"key":"unit",      "enabled":false, "label":"Unit",    "align":"left", "widthPct":7},
        {"key":"rate",      "enabled":true,  "label":"Rate",    "align":"right","widthPct":10},
        {"key":"discount",  "enabled":true,  "label":"Disc",    "align":"right","widthPct":8},
        {"key":"taxable",   "enabled":true,  "label":"Taxable", "align":"right","widthPct":11, "locked":true},
        {"key":"gstRate",   "enabled":true,  "label":"GST%",    "align":"right","widthPct":7,  "locked":true},
        {"key":"gstAmount", "enabled":true,  "label":"GST",     "align":"right","widthPct":10, "locked":true},
        {"key":"amount",    "enabled":true,  "label":"Amount",  "align":"right","widthPct":12}
      ] } },
    { "type":"totals",      "enabled":true, "locked":true,  "order":5, "options":{
        "showTaxableTotal":true, "showDiscountTotal":true,
        "showTaxBreakup":true,                   // CGST/SGST-vs-IGST — LOCKED for PAKKA
        "showRoundOff":true, "showAmountInWords":true,  // LOCKED for PAKKA
        "showPaidBalance":true } },
    { "type":"bankDetails", "enabled":true, "locked":false, "order":6, "options":{ "source":"storeConfig" } },
    { "type":"terms",       "enabled":true, "locked":false, "order":7, "options":{ "source":"storeConfig", "heading":"Terms & Conditions" } },
    { "type":"qr",          "enabled":false,"locked":false, "order":8, "options":{ "source":"upiVpa" } },
    { "type":"signature",   "enabled":true, "locked":false, "order":9, "options":{ "label":"For {{shop.name}}", "sublabel":"Authorised Signatory", "showLine":true } },
    { "type":"footerNote",  "enabled":true, "locked":false, "order":10,"options":{ "text":"Thank you for your business — visit us again!" } }
  ]
}
```

**Closed section-type enum:** `header | docTitle | invoiceMeta | billTo | lineTable | totals | bankDetails | terms | signature | footerNote | spacer | customText | qr`

**Closed column-key enum:** `sno | itemName | hsn | qty | unit | rate | mrp | discount | taxable | gstRate | gstAmount | cgst | sgst | igst | amount`

**KACHA configs** are structurally different: `docTitle.text` forced to `"ESTIMATE"` + a `"Not a Tax Invoice"` marker; `invoiceMeta.invoiceNo`, all tax columns (`hsn/gstRate/gstAmount/cgst/sgst/igst`), and `totals.showTaxBreakup` are **not offered by the editor and rejected on save**.

**Token substitution** — the only dynamic capability, allowed inside free-text fields (`tagline`, `footerNote.text`, `signature.label`, `terms.heading`). Resolved by a plain **allow-list `String.replace`** (never a template engine), output HTML-escaped, unknown tokens stripped:

```
{{shop.name}} {{shop.gstin}} {{shop.address}} {{shop.phone}} {{shop.email}}
{{invoice.no}} {{invoice.date}} {{invoice.placeOfSupply}}
{{customer.name}} {{customer.gstin}}
{{totals.grandTotal}} {{totals.grandTotalWords}}
```

A `superRefine` keyed on `docType` performs the compliance assertion at the persistence boundary, so a non-compliant document is unrepresentable regardless of a tampered client.

---

## 4. Format Catalog & Lock Rules

### Ship 6 starter templates (seeded, `isPreset:true`, cloned-to-edit)

| # | Name | docType | Paper | Notes |
|---|---|---|---|---|
| 1 | Counter receipt 58mm | PAKKA | THERMAL_58 | 32-col, HSN inline, tax summarised at foot, amount-in-words, "Reverse Charge: No" |
| 2 | Counter receipt 80mm | PAKKA | THERMAL_80 | 48-col, room for HSN/GST column + bank/UPI line |
| 3 | Tax invoice A5 | PAKKA | A5 | Half-page ruled invoice, single copy, full column table |
| 4 | Tax invoice A4 (formal/B2B) | PAKKA | A4 | Bank + UPI + T&C + optional E-Way Bill No. + ORIGINAL/DUPLICATE/TRIPLICATE copy label + delivery address |
| 5 | Estimate 80mm | KACHA | THERMAL_80 | Item + qty only, big "ESTIMATE — NOT A TAX INVOICE" banner, no tax, no number |
| 6 | Estimate A5 | KACHA | A5 | Same, half-page |

Each starter's `config` reproduces today's `Templates.tsx` output 1:1 (guarded by a snapshot test) so nothing regresses on day one. Defaults: POS walk-in → Counter receipt 80mm; B2B/contractor → Tax invoice A4.

### GST-mandatory (LOCKED) vs editable

**PAKKA — LOCKED (reorder/restyle only, never remove) per CGST Rule 46:**
- Supplier name, address & **GSTIN** (header)
- `docTitle` = "TAX INVOICE"
- **Invoice number** (gapless) + **date** (`invoiceMeta`)
- Bill-to (recipient name/GSTIN; address for B2B / high-value)
- Line table with **HSN**, **Qty+unit**, **Taxable value**, **GST rate**, **GST amount**, **Amount** columns
- Totals with **CGST/SGST-or-IGST breakup**, **round-off**, **amount-in-words**
- Place of supply + reverse-charge note
- Authorised-signatory block

**KACHA — FORBIDDEN (unrepresentable):** any tax column/breakup, the gapless invoice-number series, anything reading as a tax invoice. Must carry a visible "Not a Tax Invoice" marker.

**Freely editable (cosmetic, both types):** logo on/off + position, shop phone/email/tagline, header alignment, font family + size scale + accent (brand tokens), **column order/labels/align within the locked set**, show/hide of optional sections (bank, T&C, UPI-QR, thank-you note, copy-label), free-text header/footer, paper margins, table-border style, zebra rows. Printed output stays **English** regardless of UI language (project rule).

Locked controls render with a lock icon + tooltip "Required by GST law" so the owner understands *why* they can't remove them.

---

## 5. Editor UX

Two screens under **Settings → Bill Formats**, gated by `settings.write` (read-only summary otherwise, mirroring `settings/page.tsx`). Built entirely from existing `@hardware/ui` primitives + the `useActionState` → `'use server'` action → core service → `revalidatePath` → toast + `router.refresh()` pattern from `SettingsForm`.

### Screen 1 — Format list (`/settings/bill-formats`)
- Cards/DataTable grouped by docType (Tax Invoice / Estimate), each showing name, paper Badge, and a "Default" Badge.
- Per-row `DropdownMenu`: Edit · Duplicate · Set as default · Reset to starter · Archive. Presets are Duplicate-only.
- **"New from starter"** button → `Dialog`: pick docType → paper → starter → name → clones a preset row and opens the editor. **No blank canvas, ever.**

### Screen 2 — Editor (`/settings/bill-formats/[id]`) — split pane
On mobile the preview becomes a slide-over `Sheet` behind a "Preview" button.

**LEFT — control panel** (scroll; grouped in `Card`/`fieldset+legend`):
- **Theme:** fontFamily `Select`, base-size stepper (7–14pt), heading-scale, accent swatch row (brand tokens), density, border style, zebra `Switch`.
- **Logo:** single-image Cloudinary uploader (reuse `catalog/ImageUploader`, single-URL variant) → writes `StoreConfig.logoKey`; per-template you toggle visibility/position.
- **Sections:** ordered list, each row = enable `Switch` + label + **▲/▼ move buttons** + lock icon (disabled) for mandatory sections. Expanding a row reveals its options sub-form.
- **Line columns:** checkbox list with per-column label-override `Input`, align `Select`, ▲/▼ reorder; HSN/Taxable/GST%/GST/Amount locked-on for PAKKA.
- **Totals / Footer:** toggles for taxable/discount/round-off/paid-balance, bank/T&C source + heading, signature label/sublabel/line, footer note, optional UPI-QR.

**RIGHT — live preview:** a "paper" frame sized to true mm width, rendering the **same `BillRenderer`** against a realistic `SAMPLE_INVOICE` fixture. Toolbar: sample-scenario switch (CGST/SGST intra-state vs IGST inter-state · Walk-in vs B2B-with-GSTIN · long names/decimal qty to expose wrapping), zoom, and a **"Print test"** button (`window.print`) so the owner validates on real hardware before saving. A soft warning appears if a thermal template would overflow 32/48 columns.

**Guardrails in-UI:** locked controls can't be turned off; the KACHA editor never renders tax/invoice-number controls. Save is still re-validated server-side by `assertCompliantLockSet`.

**New primitives to build (small):** a `Switch` (native-checkbox wrapper), ▲/▼ reorder buttons (dependency-free, keyboard-accessible — matches the existing add/remove-row idiom in `PriceSlabEditor`), a single-image `LogoPicker`, and the `SAMPLE_INVOICE` fixture. New EN/HI i18n namespace `billFormats` registered in `apps/admin/i18n/request.ts` for **editor chrome only** — printed output stays English.

---

## 6. Rendering + Print/PDF Pipeline

### One isomorphic renderer
Refactor `apps/admin/app/(admin)/billing/print/Templates.tsx` (hardcoded `InvoicePrint`/`KachaPrint` + `isThermal` branch) into:

```tsx
<BillRenderer data={invoice|estimate} branding={StoreConfig} config={TemplateConfig} paperProfile={...} />
```

It walks `config.sections` in order via a `SECTION_RENDERERS` type→component map. **Preserved verbatim:** the `Frame` with `data-print-receipt`, `rupeesInWords()` (extract to `@hardware/core` so preview + print share it), and `formatMoney`/`formatPaisePlain`/`formatQty`. Money stays integer paise, qty stays decimal strings, tax split stays keyed off `invoice.taxKind`. The renderer is **display-only** — it never recomputes money, tax, or the invoice number.

**Paper profiles** (formalise today's `isThermal` into data):

| Profile | Paper width | Printable width | Font | Layout |
|---|---|---|---|---|
| THERMAL_58 | 58mm | **~48mm** | mono | single stacked column, HSN inline, low-priority columns auto-dropped by width |
| THERMAL_80 | 80mm | **~72mm** | mono | single column, real HSN/GST column fits |
| A5 | 148mm | 148mm | serif/sans | ruled columned table |
| A4 | 210mm | 210mm | serif/sans | ruled columned table + bank/T&C/copy-label |

**Theme → a FIXED Tailwind class table inside the renderer** (accent maps only to brand tokens). No class/CSS string ever comes from config.

### Print (Tier 1 — primary, thermal AND A4/laser)
Browser `window.print()` of the live DOM, reusing the existing `@media print` isolation in `globals.css`. **This ships the single biggest real-world fix, which is currently missing entirely:**

- Inject a per-paper `@page` rule (there is **no `@page` anywhere today**): `@page { size: 58mm auto | 80mm auto | A5 | A4; margin: 0 }`. The `auto` height = variable-length thermal rolls.
- Set content width to the **printable area (48/72mm), not the full roll** — this stops the right-edge Amount column clipping on real thermal heads.
- Add `print-color-adjust: exact` (keeps logo/shaded header) and `page-break-inside: avoid` on rows.
- Preload/await the logo image before `window.print()` (else it silently drops).

**The honest truth about raw thermal printing from the web:** true ESC/POS (auto-cut, cash-drawer, no dialog) is **not reliably possible from plain web APIs** — WebUSB/Web Serial are Chrome/Edge-only, HTTPS + gesture gated, and on Windows the OS printer driver usually claims the USB device so `open()` fails. The pragmatic path that needs **no extra software**: install the thermal printer as a normal OS printer (vendor driver), set its default paper to the roll width, render the 58/80mm HTML with the correct `@page`, and `window.print()` selecting that printer. You lose the cutter/drawer niceties. If those are later required, the only reliable options are a **local bridge (QZ Tray)** or a **cloud agent (PrintNode REST API)** — out of scope for v1, noted as an upgrade path. For dialog-free counter printing, launch the admin app in Chrome `--kiosk-printing`.

### PDF (Tier 2 — optional, for download/email/audit; separable slice)
A Node-runtime route `/api/billing/[id]/pdf` (`runtime='nodejs'`, `maxDuration=60`) renders the **same `BillRenderer`** via `renderToStaticMarkup`, then `puppeteer-core` + `@sparticuz/chromium-min` → `page.pdf({ printBackground:true, preferCSSPageSize:true })` so the CSS `@page` wins for thermal and A4 alike.

**Gotchas (call these out to the owner before committing):**
- Version-lock `puppeteer-core` to the matching `@sparticuz/chromium` (~Chrome 133 / puppeteer 24.x) or launch fails.
- Add `serverExternalPackages: ['@sparticuz/chromium','puppeteer-core']` in `next.config.ts`.
- Host the Chromium brotli pack on Cloudinary (already in use) and pass `chromium.executablePath(url)` to stay under Vercel's 50MB-compressed function limit.
- **Lambda Chromium ships almost no fonts** — embed a monospace + a text font as `@font-face` data-URIs or glyphs render blank.
- **Vercel Hobby memory is fixed at 1024MB** — a cold Chromium A4 render is OOM-prone (repo is on Hobby: daily crons only). **Decision required:** either move the billing app to Pro for this path, or ship `@react-pdf/renderer` as a Hobby-safe fallback (accepting a *second* template authored in its component vocabulary, kept in sync via the shared `TemplateConfig`). **Do not use `@vercel/og`/Satori** — it rasterises to a single PNG and can't paginate a multi-line A4 invoice.

Tier 1 (`window.print`) satisfies day-to-day counter printing on its own; Tier 2 is only needed for stored/emailed PDFs and is a fully separable phase.

---

## 7. Integration with Existing Billing

- **`finalizePakka` / `finalizeKacha` / `convertKachaToPakka` — untouched.** Tax orchestration (CGST/SGST vs IGST by place-of-supply) and gapless numbering (`InvoiceCounter`, `nextInvoiceNo`, `formatInvoiceNo` under row lock) stay entirely server-side. Templates only *display* `invoice.invoiceNo` and pre-computed paise. The editor exposes **presentation knobs only** — it can never re-derive money or a number.
- **`StoreConfig`** remains the single source of truth for branding; `BillTemplate.config` references it, never copies it. New pointers `default{Pakka,Kacha}TemplateId` + `upiVpa` are additive.
- **`PosClient` + `ReprintClient`:** the current hardcoded 4-option `PrintSize` `<Select>` generalises to a **saved-template `<Select>` keyed by docType**, defaulting to `StoreConfig.default{Pakka,Kacha}TemplateId`. Both call the same `BillRenderer`.
- **Data feeding the renderer already exists** in `InvoiceDTO` / `InvoiceLineDTO` / `KachaEstimate`. One gap to close: product/unit **names** are resolved separately via the `getProduct` join (`invoices/[id]/page.tsx:54`). Fold this into a server-built **`BillViewModel`** so preview and print share identical, namespaced data (`store.* / doc.* / party.* / line.* / totals.* / payment.*`), each money token carrying a formatted sibling.
- **Credit notes** are a third document type (`CreditNoteDTO`). Support them as a **later, optional** template kind (they have no unitPrice/HSN/round-off/payments). Not in the v1 catalog to keep scope tight.
- **GST compliance is preserved by three layers:** (1) locked controls in the UI; (2) `assertCompliantLockSet` inside the save transaction rejects a tampered client; (3) the renderer defensively re-injects any missing mandatory PAKKA section so even a corrupt row can't print a non-compliant invoice.

### Known data-model gaps for *full* A4/B2B compliance (surface to owner; can be follow-up slices)
- Recipient **address + numeric GST state code** are not snapshotted on `Invoice` (only name + GSTIN). Needed for B2B / ≥₹50,000 B2C and for IGST place-of-supply.
- No explicit **reverse-charge** flag (template hardcodes "No" for retail — fine for now).
- No **ORIGINAL/DUPLICATE/TRIPLICATE** copy data (layout can host it; value is a constant label).
- `hsnCode` is nullable per line — the HSN *column* is locked-on, but products missing a code print blank (a master-data completeness issue to flag, not a template bug).

---

## 8. Delivery Slices

Each slice is small and independently shippable. House style: land the renderer + print fixes *before* any editor UI, so real value ships early and the editor builds on a proven base.

| Slice | What ships | Effort | Key risks |
|---|---|---|---|
| **S1 — Config-driven renderer (pure refactor)** | Refactor `Templates.tsx` into `<BillRenderer>` + `SECTION_RENDERERS` + `TemplateConfig` types + `SAMPLE_INVOICE` fixture. Extract `rupeesInWords` to core. Reproduce today's output 1:1, guarded by DOM/visual snapshot tests. No user-visible change. | **M** | Regression vs current output — mitigate with snapshot tests seeded from existing components before deleting the hardcoded branches. |
| **S2 — Real print CSS (`@page`) + printable-width fix** | Inject per-paper `@page` (size/margin), printable-area width, `print-color-adjust:exact`, row page-breaks, logo-load guard. Fixes the top live defect. | **S** | Thermal fidelity only verifiable on real hardware — needs one physical test + a shop printer-setup note. |
| **S3 — Data model + core service + seed** | `BillTemplate` model + enums + migration + 3 `StoreConfig` columns; `billTemplateConfigSchema`; `assertCompliantLockSet`; `upsertBillTemplate` (guarded+audited); seed the 6 starter presets; wire logo into the view-model. | **M** | Compliance-guard correctness; migration/seed must reproduce presets exactly. |
| **S4 — Selectable formats wired into POS/reprint** | Generalise `PosClient`/`ReprintClient` size `<Select>` → saved-template `<Select>` keyed by docType, defaulting from `StoreConfig`. Shopkeeper can now *pick* saved formats (even before the editor). | **S** | Default-resolution edge cases (no default set → preset fallback). |
| **S5 — Editor: format list + theme/branding + logo** | Screen 1 (list, new-from-starter, duplicate/default/reset/archive) + Screen 2 left-panel theme/logo/header controls + right-panel live preview. Reuse SettingsForm pattern; build `Switch` + `LogoPicker`. | **L** | New UI surface; scope discipline — ship theme/branding first, sections next. |
| **S6 — Editor: sections + columns + toggles + locks** | Ordered section list with enable/▲▼/lock, line-column editor, totals/footer toggles, in-UI GST lock affordances. Full no-code editing. EN/HI `billFormats` namespace. | **L** | Lock-set UX clarity; keep locked fields obviously non-removable. |
| **S7 (optional) — Server PDF** | `/api/billing/[id]/pdf` via puppeteer-core + `@sparticuz/chromium-min` (or `@react-pdf` fallback), embedded fonts, inlined logo. | **M–L** | Vercel Hobby OOM/cold-start — needs the Pro-vs-@react-pdf decision (see §9). |
| **S8 (optional) — Compliance data extensions** | Snapshot recipient address + GST state code + reverse-charge flag + copy labels onto `Invoice`/DTO for fully-compliant B2B A4. | **M** | Schema change + snapshot migration; sequence after S6. |
| **S9 (optional) — Header/footer HTML snippet (Hybrid C escape hatch)** | Whitelisted-HTML snippet for header/footer only, sanitised at render. Only if the owner needs custom promo/footer markup beyond plain text + tokens. | **M** | The one XSS surface — requires a maintained sanitizer (`isomorphic-dompurify`/`sanitize-html`, net-new dep) + fuzz tests + tightened admin CSP. Defer unless demanded. |

**Minimum viable feature = S1–S6.** S7–S9 are genuinely optional and gated on owner decisions.

---

## 9. Open Decisions to Confirm with the Owner

1. **Server PDF, and the Vercel plan.** Is a downloadable/emailable PDF needed, or is on-the-spot `window.print()` enough for v1? If PDF is needed: **upgrade the billing app to Vercel Pro** (for the high-fidelity Chromium path) **or** accept a second `@react-pdf` template to maintain on Hobby? (Affects S7.)
2. **Raw thermal control.** Is auto-cut / cash-drawer / dialog-free printing required? If yes, that means a QZ Tray (self-hosted) or PrintNode (paid REST) integration — a separate project. If no, plain OS-driver + `window.print()` is the v1 answer.
3. **Header/footer HTML snippet (S9).** Do owners realistically need custom markup (festival greetings, styled promos) beyond plain text + `{{tokens}}`? If not, skip S9 and its sanitizer maintenance burden entirely.
4. **B2B compliance depth (S8).** Will the shop issue B2B invoices ≥₹50,000 / inter-state (IGST) where recipient address + GST state code + ORIGINAL/DUPLICATE/TRIPLICATE are legally expected? Drives whether S8 is v1 or later.
5. **Credit-note templates.** In scope now, or later? (Recommend later.)
6. **Per-template logo.** Store-wide logo (`StoreConfig.logoKey`) is assumed. Any need for different logos per format? (Would require a further model change.)
7. **UPI scan-to-pay QR.** Include the optional static UPI-VPA QR block now (self-contained, display-only; online payment/Razorpay is disabled) or defer?
8. **Permission taxonomy.** Reuse `settings.write` to gate the editor, or introduce a dedicated `billing.templates` permission?

---

## Key file references (for the developer)
- Renderer to refactor: `apps/admin/app/(admin)/billing/print/Templates.tsx` (`PrintSize` L20, `WIDTH` L39, `isThermal` L46, `Frame` L54, `InvoicePrint` L94, `KachaPrint` L250, `rupeesInWords` L347)
- Print isolation (add `@page` here): `apps/admin/app/globals.css:82`
- Print entry points: `PosClient.tsx:183/1036/1050`, `invoices/[id]/ReprintClient.tsx:25/43`
- Data contracts: `packages/core/src/billing/service.ts` — `InvoiceDTO:277`, `InvoiceLineDTO:257`, `KachaEstimate:186`, `CreditNoteDTO:931`
- Line-label join to fold into the view-model: `invoices/[id]/page.tsx:54`
- Settings pipeline to mirror: `packages/core/src/settings/{schema.ts,service.ts:89}`, `apps/admin/app/(admin)/settings/{SettingsForm.tsx,actions.ts,page.tsx}`
- Reusable Cloudinary uploader: `apps/admin/app/(admin)/catalog/ImageUploader.tsx`
- Schema anchor: `packages/db/prisma/schema.prisma:352` (`StoreConfig`)
