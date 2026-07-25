# 01 — Design System Spec (Hardware Store)

> **Status:** Authoritative. This is the single source of truth for the UI/UX polish + hardening
> pass across **both** apps (`apps/admin` operational console, `apps/storefront` retail shop).
> Every worker MUST read this before styling a screen.
>
> **Scope guardrail (READ FIRST):** This pass touches **presentation only** — layout, spacing,
> component composition, states, responsiveness, accessibility, and UI-bug fixes. **Do NOT** change
> business logic, `packages/core` domain services, the Prisma schema, server-action / route-handler
> *behavior*, or any data wiring. If you find a *functional* bug (wrong total, broken mutation,
> security hole), **flag it** in your report with evidence — do not silently rewrite it.
>
> **Money:** data is **integer paise**; render via `formatMoney(paise) → "₹1,23,456.00"`.
> **Quantities** are **decimal strings**; render via `formatQty(str)` — never coerce to JS `number`
> for display rounding.

---

## 0. Build state & ownership

| Layer | Path | Who edits it |
|---|---|---|
| Tokens / globals | `apps/*/app/globals.css`, `packages/config/tailwind.preset.ts` | **Foundation agent only** |
| Shared components | `packages/ui/src/**` | **Foundation agent only** |
| Admin screens | `apps/admin/app/(admin)/**`, `(auth)/login` | Admin screen workers |
| Storefront screens | `apps/storefront/app/**` (non-`api`) | Storefront screen workers |

Workers **import from `@hardware/ui`** and **compose** — they never re-implement primitives and never
touch `packages/ui`, `globals.css`, or the Tailwind preset. The dev servers hot-reload edits (admin
`:3001`, storefront `:3000`) and **share `.next`** — **never run `pnpm build`**. Validate with
`pnpm typecheck && pnpm lint && pnpm --filter @hardware/core test`.

Tokens are **already installed** (shadcn HSL variables wired through the preset). `bg-background`,
`text-foreground`, `bg-card`, `text-muted-foreground`, `border`, `bg-primary`,
`text-primary-foreground`, `bg-destructive`, `rounded-lg`, `ring-ring` etc. **all resolve today**.

---

## 1. Brand & identity

Two surfaces, one system. Same component library, same scale, same patterns — they diverge only in
**accent hue** and **density**.

| | **Admin** (operational) | **Storefront** (retail) |
|---|---|---|
| Primary hue | **Blue** `--primary: 221.2 83.2% 53.3%` | **Orange** `--primary: 24.6 95% 53.1%` |
| Personality | Dense, fast, keyboard-friendly, data-first | Roomy, friendly, confident, conversion-first |
| Density | **Compact** — table rows `h-9`, `text-sm`/`text-xs`, tight gutters | **Comfortable** — generous padding, `text-sm`/`text-base`, air around cards |
| Container | Full-bleed inside the app shell; content `max-w-screen-2xl` for wide tables | Centered `max-w-5xl` (lists) / `max-w-3xl` (detail/forms) |
| Mood | "Cockpit" | "Aisle of a well-lit store" |

Both already define `:root` + `.dark` token blocks. **Do not introduce new raw hex/HSL colors in
screens.** Use semantic tokens. The few hard-coded `text-green-700`, `text-red-600`, `bg-amber-50`,
`bg-red-50` found in current screens are to be **replaced by the Badge variants and semantic tokens**
defined in §4/§6 — see the per-screen checklist.

### 1.1 Typography scale

System font stack (no webfont dependency). Use Tailwind's defaults mapped as:

| Token | Class | Use |
|---|---|---|
| Page title | `text-xl font-semibold` (admin) / `text-2xl font-semibold` (storefront) | `h1` via `PageHeader` |
| Section heading | `text-sm font-semibold` (admin) / `text-base font-semibold` (storefront) | `h2` |
| Body | `text-sm` | default reading size |
| Secondary / meta | `text-xs text-muted-foreground` | captions, helper text, table sub-labels |
| Table header | `text-xs uppercase tracking-wide text-muted-foreground` | `thead` |
| Numeric | add **`tabular-nums`** to **every** money/qty/count cell | alignment |

Money and quantities are **always** `tabular-nums` and **right-aligned** in tables.

### 1.2 Spacing, radius, elevation, density

- **Spacing scale:** 4px base (Tailwind default). Standard rhythm: page padding `p-6`; vertical
  section gap `space-y-6`; intra-section `space-y-3`/`gap-3`; form field gap `gap-2`.
- **Radius:** `--radius: 0.5rem`. Use `rounded-lg` (cards, dialogs, sheets), `rounded-md` (buttons,
  inputs, badges-rect), `rounded-full` (pill badges, avatars). Never raw `rounded` or pixel radii.
- **Elevation:** flat-first. Cards = `border bg-card` (no shadow). Raise only floating layers:
  dropdowns/popovers/command lists `shadow-md`, dialogs `shadow-lg`, toasts `shadow-lg`. Avoid
  shadows on static page content.
- **Borders:** always `border` (token-driven `border-border`), never `border-gray-*`.
- **Focus:** every interactive element shows `focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-ring` (already baked into `Button`/`.input`; keep it on custom controls).

---

## 2. Component inventory (`packages/ui`)

Build these in `packages/ui/src/components/**`, export from `packages/ui/src/index.ts`. Each is
**unstyled-by-brand** — it reads semantic tokens so the same component renders blue in admin and
orange in storefront automatically. `Button` already exists; the rest are **to build** (Foundation).
APIs below are the contract screen workers code against.

> Convention: every component takes `className` (merged via `cn`), forwards `ref`, spreads native
> props, and uses `cva` for variants where it has them. `cn` is exported from `@hardware/ui`.

### 2.1 Primitives

- **`Button`** *(exists)* — variants `default | outline | ghost | destructive`; **add** `secondary`
  and `link`; sizes `sm | default | lg`; **add** `icon` (square, for icon-only). Add an
  `isLoading?: boolean` prop that disables and renders a leading `Spinner` (replaces the ad-hoc
  `"Working…"` / `"Signing in…"` text swaps scattered in screens).
- **`Input`** — styled `<input>`. Replaces the repeated `className="rounded-md border px-3 py-1.5
  text-sm"` and the `.input` `@layer` utility. Props: native + `className`. Error state via
  `aria-invalid` → red ring.
- **`Textarea`** — multiline sibling of `Input`.
- **`Label`** — `<label>`; pairs with `htmlFor`; `text-sm font-medium`. Marks required with a
  muted `*`.
- **`Select`** — styled native `<select>` wrapper (keep native for reliability/POS speed). Same
  metrics as `Input`. (A `DropdownMenu`-based combobox is **not** required; native select stays.)
- **`Checkbox`** — accessible box; `text-sm` label slot. Replaces raw `<input type="checkbox">`.
- **`Textbox helpers`**: `FormField` (optional convenience) = `Label` + control + `text-xs`
  helper/error stack with `space-y-1`. Optional but recommended for the forms in §5.

### 2.2 Data display

- **`Table`** — token-styled table parts: `Table`, `TableHeader`, `TableBody`, `TableRow`,
  `TableHead`, `TableCell`, `TableCaption`. Defaults: header `text-xs uppercase
  text-muted-foreground border-b`, rows `border-b last:border-0`, cell padding `py-2 px-3`,
  hover `hover:bg-muted/40`. A `numeric` prop on `TableHead`/`TableCell` applies
  `text-right tabular-nums`.
- **`DataTable`** — thin wrapper over `Table` that standardizes the **list-page shell**: optional
  toolbar slot (search/filters), the table, an **`EmptyState`** when `rows.length === 0`, a
  **`Skeleton`** body when `isLoading`, and a footer **pagination** slot (cursor "Next page →").
  This is what every admin list and the storefront catalog should converge on.
- **`Badge`** — `cva` with the **status variants** in §6. Base: `inline-flex items-center
  rounded-full border px-2 py-0.5 text-xs font-medium`. Variants resolve to token-tinted
  fills (`bg-*/10 text-* border-*/20`), never raw Tailwind palette in screens.
- **`StatCard`** — the dashboard/report KPI tile. Props: `label`, `value`, `sub?`, `href?`,
  `tone? = "default" | "warning" | "destructive"`, `icon?`. Renders `rounded-lg border bg-card
  p-4`, label `text-xs uppercase text-muted-foreground`, value `text-lg font-semibold tabular-nums`.
  Replaces the three separate `Stat` components copy-pasted in dashboard/reports/ledger.
- **`EmptyState`** — `icon?`, `title`, `description?`, `action?` (a `Button`/link slot). Centered,
  `text-muted-foreground`. Replaces every bare `<p>No products… </p>` empty message.
- **`Skeleton`** — `animate-pulse rounded-md bg-muted`. Building block for loading rows/cards.
- **`Spinner`** — sized SVG spinner (`size: sm | default`); used by `Button isLoading` and
  Suspense fallbacks.

### 2.3 Overlays & navigation

- **`Dialog`** — modal (Radix-style API): `Dialog`, `DialogTrigger`, `DialogContent`,
  `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`. Focus-trapped,
  Esc-to-close, overlay `bg-black/50`, content `rounded-lg border bg-card shadow-lg`. Use for
  destructive confirms (cancel invoice, cancel order, archive product) and small create forms.
- **`Sheet`** — side drawer (same primitives, slides from `right`/`left`/`bottom`). Use for the
  **storefront mobile nav** and the **admin mobile sidebar**, and optionally the POS cart on small
  screens.
- **`DropdownMenu`** — `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`,
  `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuLabel`. Use for the admin **topbar user
  menu** (profile / sign out) and row "⋯" actions.
- **`Tabs`** — `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. Underline style. This **replaces**
  the bespoke `StockNav` / `BillingNav` / `LedgerNav` / `ReportsNav` sub-section link bars with one
  consistent, accessible, active-aware pattern (render as links when they navigate routes).
- **`Toast` / Sonner** — a `<Toaster />` mounted once per app root + a `toast()` helper
  (`toast.success` / `toast.error` / `toast.info`). This is the **standard success/error feedback**
  channel, replacing inline green/red `<p>` banners after mutations (POS, ledger payment, settings,
  order actions). Errors that block submission may *also* show inline near the control.

### 2.4 Layout chrome

- **`PageHeader`** — `title`, `description?`, `actions?` (right-aligned button slot), `breadcrumbs?`.
  Standardizes the `flex items-center justify-between` + `h1` + helper-text pattern repeated on
  ~every screen. Admin: `text-xl`. Storefront: `text-2xl`.
- **`AppShell` parts (admin)** — `Sidebar`, `SidebarNav`, `SidebarNavItem` (icon + label + active
  state), `Topbar`. See §3. These live in `packages/ui` as presentational shells; the **nav item
  list** (with RBAC gating) is composed in `apps/admin/app/(admin)/layout.tsx`.
- **`Container`** — optional helper applying the storefront `mx-auto max-w-5xl px-6` (or `max-w-3xl`)
  rhythm so pages stop re-declaring it.

### 2.5 Formatting helpers (`packages/ui/src/lib/format.ts`)

Single source of truth for display formatting — **export from `@hardware/ui`**. Screens stop
hand-rolling `(paise/100).toFixed(2)` and the five copies of `rupees()`.

```ts
formatMoney(paise: number, opts?: { sign?: boolean }): string
//  123456  -> "₹1,234.56"   (en-IN grouping: ₹1,23,456.00 for larger values)
//  negative -> "-₹1,234.56"  (or wrap as the caller wishes)

formatPaisePlain(paise: number): string   // no ₹ symbol, for inputs/print columns
formatQty(qty: string, unit?: string): string
//  "12.500", "kg" -> "12.5 kg"  (trims trailing zeros, keeps decimal strings exact)

formatDate(d: Date | string): string       // en-IN short date
formatDateTime(d: Date | string): string    // en-IN date + time
```

> **Correctness note:** these are **display-only**. The server remains authoritative for all money
> math (paise integers). `formatMoney` must group with the Indian locale and must **not** be used to
> re-derive totals. Quantities must be formatted from their **decimal string**, never via
> `Number()` rounding.

---

## 3. App shell design

### 3.1 Admin shell *(new — currently MISSING)*

**Finding:** there is **no `(admin)/layout.tsx`** today. Every admin page renders bare `<main
className="p-6">` and the only navigation is an ad-hoc link row on the dashboard plus per-section
`*Nav` bars. This is the single biggest structural gap. The Foundation/admin-shell worker must add:

```
apps/admin/app/(admin)/layout.tsx   →  <AppShell sidebar={…} topbar={…}>{children}</AppShell>
```

**Layout:** fixed left **Sidebar** (`w-60`, `bg-card border-r`, collapses to a `Sheet` under `lg`)
+ sticky **Topbar** (`h-14 border-b bg-background`) + scrollable content region (`p-6`,
`max-w-screen-2xl`).

**Sidebar nav (primary):** icon + label, grouped, with **active state** (`bg-primary/10
text-primary font-medium`, left accent bar). Items, each gated by the permission the destination
already enforces server-side (UI hiding is cosmetic — keep the server checks):

| Item | Route | Gate (existing perm) |
|---|---|---|
| Dashboard | `/dashboard` | `products.read` |
| Catalog | `/catalog` | `products.read` |
| Stock | `/stock` | `stock.read` |
| Billing | `/billing` | `bill.kacha.create` ∥ `bill.pakka.create` |
| Ledger | `/ledger` | `ledger.read` |
| Orders | `/orders` | `orders.read` |
| Reports | `/reports` | `reports.read` |
| Settings | `/settings` | `settings.read` |
| Audit *(optional, under Settings)* | `/audit` | `audit.read` |

**Topbar:** left = mobile hamburger (opens sidebar `Sheet`) + current section title/breadcrumb;
right = **user menu** (`DropdownMenu`: shows signed-in staff name/role, **Sign out** posting to the
existing `logoutAction`). The dashboard's inline "Sign out" `<form>` and link row are **removed**
once the shell exists.

**Sub-section navigation:** Stock / Billing / Ledger / Reports keep their secondary nav, but rendered
through the shared **`Tabs`** pattern (link-mode) instead of four bespoke `*Nav` components, so the
active style is consistent. The `Forbid` component duplicated in those nav files is replaced by a
single shared `ForbiddenState` (an `EmptyState` preset) — but its **behavior** (which perm it names)
is unchanged.

### 3.2 Storefront shell

**Header** (`apps/storefront/app/Header.tsx`, already a client component for the live cart count):
upgrade to the standard retail header — `border-b bg-background`, centered `max-w-5xl`:

- **Left:** logo/wordmark "Hardware Store" (`font-semibold`, links home).
- **Center (≥ md):** primary nav — Catalog, My orders, Account.
- **Right:** a **search affordance** (links to `/?q=` or opens an inline search) and the **Cart**
  button with a **count badge** (`Badge` pill, `bg-primary text-primary-foreground`) — replacing the
  current `Cart (n)` text. Cart badge hidden when `count === 0`.
- **Mobile (< md):** collapse nav into a `Sheet` opened by a hamburger; keep cart + search visible.

**Footer** *(new — currently MISSING):* add a simple storefront footer (store name, short blurb,
"Pay online / Pay at store", GST/HSN note, copyright). `border-t bg-muted/30`, muted text, centered
`max-w-5xl`, stacks on mobile. Mount in `apps/storefront/app/layout.tsx` after `{children}`.

---

## 4. Standard patterns

### 4.1 Page header
Every route opens with `PageHeader` (title + optional description + right-aligned primary action).
No more hand-built `flex items-center justify-between` + `h1`.

### 4.2 Tables (list pages)
Use `Table`/`DataTable`. Rules:
- Header row: `text-xs uppercase text-muted-foreground border-b`.
- Money/qty/count columns: right-aligned, `tabular-nums`, formatted via §2.5 helpers.
- First column is the entity name as a **link** (`font-medium hover:underline`) where a detail page
  exists.
- Row hover `hover:bg-muted/40`. Zebra striping **not** used (keep it clean/dense).
- Horizontal scroll on small screens via `overflow-x-auto` wrapper (POS lines, wide reports).
- Always pair with **EmptyState** (no rows) and **Skeleton** (loading).

### 4.3 Forms
- One column on mobile, `sm:grid-cols-2` for short fields on desktop; full-width for long ones.
- `Label` above control, `text-xs` helper/error below (`FormField`), `space-y-1` per field,
  `gap-4` between fields.
- Primary submit = `Button` (brand). Secondary = `Button variant="outline"`. Destructive =
  `Button variant="destructive"` behind a `Dialog` confirm.
- Submit buttons use `isLoading` (spinner + disabled) — never disappear the label.
- Validation errors surface inline near the field; the **submit result** (success/failure) goes to a
  **toast**.

### 4.4 Empty / loading / error states
- **Empty:** `EmptyState` with a one-line reason + a next action (e.g. "No products match. Create one
  or import a CSV." → buttons). Never a lone gray sentence.
- **Loading:** `Skeleton` rows/cards matching the final layout; `Spinner` for inline/async buttons.
  Use route-level `loading.tsx` with skeletons for server-component pages where helpful.
- **Error:** unexpected → friendly error card with a retry; **Forbidden (403)** → shared
  `ForbiddenState` naming the missing permission (preserves today's wording). **404** → `notFound()`
  stays; give it a styled not-found page.

### 4.5 Toast feedback
Mount `<Toaster />` once per app root. After every successful mutation, `toast.success(...)`; on
failure, `toast.error(message)`. Applies to: POS finalize (kacha/pakka/convert), record payment,
send reminder, settings save, product create/archive, price-slab edits, GRN/adjustments, order
fulfilment transitions, address add/edit, profile save, auth flows. **This is presentation of
existing results — it must not change what the action returns or does.**

### 4.6 Print surfaces (do not regress)
`apps/admin/.../billing/print/Templates.tsx` + the `@media print` rule in admin `globals.css` drive
thermal/A4/A5 receipts via `[data-print-receipt]`. **Leave the print isolation rule and the
templates' structure intact.** Polish is limited to on-screen chrome around them (the "Print" button,
size selector → `Select`, result banner → toast). The receipt DOM that printing depends on must keep
its `data-print-receipt` markers and layout.

---

## 5. Money & quantity formatting (consistency rule)

- **Display money** only through `formatMoney(paise)` → `₹` + en-IN grouping + 2 decimals.
- **Display quantities** only through `formatQty(decimalString, unit?)` — exact decimal strings.
- Remove the **five duplicated `rupees()` helpers** (dashboard, `ledger/nav`, `billing/preview`,
  `reports/nav`, inline in orders) and the scattered `(x/100).toFixed(2)` — import from `@hardware/ui`.
- **Inconsistency to fix (presentation only):** the dashboard/report `rupees()` renders
  `Math.floor(abs/100).(remainder)` **without thousands separators**, while other screens use
  `.toFixed(2)`. Standardize all to `formatMoney`. *(The POS `preview.ts` `rupees` is used for live
  preview next to server-authoritative totals — swap its **display** to `formatMoney` but keep the
  integer-paise math untouched.)*

---

## 6. Status badge color map

All status pills use the **`Badge`** component variants — **no raw palette classes in screens**. Map:

### Order status (`order` enum: `PENDING_PAYMENT`, `PAY_LATER`, `CONFIRMED`, `PACKED`, `DISPATCHED`, `COMPLETED`, `CANCELLED`)
| Status | Variant | Tone |
|---|---|---|
| `PENDING_PAYMENT` | `warning` | amber — awaiting payment |
| `PAY_LATER` | `info` | blue/neutral — pay at store |
| `CONFIRMED` | `info` | accepted, in queue |
| `PACKED` | `info` | progressing |
| `DISPATCHED` | `info` (emphasis) | out for delivery |
| `COMPLETED` | `success` | green — done |
| `CANCELLED` | `destructive` | red |

> The product spec also uses the labels PENDING / CONFIRMED / PACKED / DISPATCHED / COMPLETED /
> CANCELLED; map `PENDING_PAYMENT` + `PAY_LATER` both under the "pending/awaiting" presentation.
> **Render human labels** (`DISPATCHED` → "Dispatched", `PENDING_PAYMENT` → "Awaiting payment") via a
> small label map — do **not** rename the underlying enum values.

### Invoice status
| Status | Variant |
|---|---|
| `ACTIVE` | `success` (or neutral `default`) |
| `CANCELLED` | `destructive` |

### Stock status
| Condition | Variant |
|---|---|
| In stock / OK | `success` |
| Low (≤ reorder) | `warning` |
| Out of stock (available ≤ 0) | `destructive` |

### Payment mode (POS / day-end)
Neutral pills, not status-colored: `CASH`, `UPI`, `CARD`, `KHATA` → `Badge variant="outline"` (the
**selected** mode in the POS toggle uses `bg-primary text-primary-foreground`). Razorpay vs
Pay-later on storefront orders → `info` / `outline`.

### Aging / receivables
`0–30` neutral, `31–60` neutral, **`60+` → `destructive` when > 0** (matches existing ledger
emphasis). Outstanding total is `font-semibold tabular-nums`.

**Badge variant tokens** (Foundation defines in `cva`):
`success = bg-emerald-500/10 text-emerald-700 border-emerald-500/20` (dark-mode lightened),
`warning = bg-amber-500/10 text-amber-700 border-amber-500/20`,
`info = bg-blue-500/10 text-blue-700 border-blue-500/20`,
`destructive = bg-destructive/10 text-destructive border-destructive/20`,
`outline = border text-foreground`, `default = bg-muted text-foreground`. These are the **only**
places semantic status colors are defined; screens reference the variant, not the color.

---

## 7. Accessibility baseline (applies to every screen)

- All inputs have an associated `Label` (visible or `sr-only`). The bare `placeholder`-only inputs
  (login, search boxes, POS fields) get real labels.
- Color is never the sole signal: status uses **icon/text + color** (badges carry text).
- Focus rings preserved (`ring-ring`) on all interactive elements; never `outline-none` without a
  visible replacement.
- Dialogs/sheets trap focus, restore on close, close on Esc, and have titles.
- Tables use `<th scope>`; numeric columns right-aligned.
- Tap targets ≥ 40px on storefront (retail, mobile-heavy); admin may be denser but keep clickable
  rows/buttons ≥ 32px.
- Respect `prefers-reduced-motion` for spinners/transitions.

---

## 8. Per-screen polish checklist

> For each route: **what good looks like.** Workers polish presentation only; preserve all data
> wiring, perm checks, and action behavior. ✅ = add/standardize; ⚠️ = bug/inconsistency to fix
> (presentation) or **flag** (if functional).

### ADMIN — `apps/admin`

**`(auth)/login` — Owner sign in**
- ✅ Center card on `bg-muted/30`; wrap form in a `Card`; brand mark on top.
- ✅ `Label`s for email/password (currently placeholder-only); `Input` components.
- ✅ Error via inline alert (red ring + message); `Button isLoading` for the pending state
  (replace the `"Signing in…"` text swap). Keep `loginAction` + autocomplete attrs.

**`(admin)/layout.tsx` — App shell *(NEW)***
- ✅ Build `AppShell` (sidebar + topbar) per §3.1; RBAC-gated nav; user menu → existing
  `logoutAction`; mobile `Sheet`.

**`(admin)/dashboard` — Dashboard**
- ✅ `PageHeader` "Dashboard"; remove the inline sign-out form + link row (now in shell).
- ✅ KPI tiles → `StatCard` (Today's invoices, Today's sales, Low-stock, Receivables) with
  `tone="warning"` on low-stock when > 0; keep `href`s.
- ✅ Top-items & Low-stock tables → `Table`; money via `formatMoney`; `EmptyState` for the two
  empty cases. Keep `getDashboard()` + perm fallback exactly.

**`(admin)/catalog` — Product list**
- ✅ `PageHeader` with actions (Masters, Import CSV → `Button variant="outline"`/`link`;
  **New product** → primary `Button`). Filter bar → `Input` + `Checkbox` + `Button`.
- ✅ `DataTable`; price via `formatMoney`; **Status** cell → `Badge` (`success` Active / `default`
  Archived) instead of `text-green-700`. `EmptyState` + "Next page →" footer.

**`(admin)/catalog/new` & `catalog/[id]` & `ProductForm` & `PriceSlabEditor` & `ProductActions`**
- ✅ Form via `FormField`/`Input`/`Select`/`Label`; section grouping; `PageHeader` with breadcrumb
  back to Catalog.
- ✅ Price slabs in a `Table` with add/remove rows; money inputs labeled "₹".
- ✅ Archive/restore → `Button variant="destructive"` behind a `Dialog` confirm; result → toast.
- ⚠️ Keep all `actions.ts` mutations and price math unchanged.

**`(admin)/catalog/masters` (Units/Categories/Brands) & `catalog/import`**
- ✅ `Tabs` for the three master types or three `Card` sections; `DataTable` each; create via
  inline form or `Dialog`. Import: dropzone styling, job progress as `Skeleton`/status `Badge`;
  result toast. Keep import job polling logic intact.

**`(admin)/stock` — Stock list**
- ✅ `StockNav` → shared `Tabs`. `PageHeader` + "New GRN" primary action. `DataTable`; **Status**
  cell → `Badge` (`success` OK / `warning` Low) — replaces the `bg-destructive/10`/`text-green-700`
  ad-hoc pills. Qty columns `formatQty`, right-aligned.

**`(admin)/stock/grn` + `GrnForm`**
- ✅ Multi-line GRN editor in a `Table`-style grid; supplier `Select`; batch/expiry/qty/cost
  `Input`s labeled; running totals `tabular-nums`. Submit `isLoading`; success toast. Keep
  GRN posting behavior.

**`(admin)/stock/adjustments` + `StockForms`, `stock/movements`, `stock/near-expiry`, `stock/suppliers` + `SupplierForm`**
- ✅ Each: `Tabs` chrome, `PageHeader`, `DataTable` + `EmptyState`. Movement ledger: type column →
  neutral `Badge`; qty signed + `tabular-nums`. Near-expiry: days-to-expiry → `warning`/`destructive`
  `Badge`. Suppliers: dues via `formatMoney`. Forms → shared inputs; toasts on save.

**`(admin)/billing` (POS) + `PosClient` + `nav` + `preview` + `invoices` + `invoices/[id]` + `print/Templates`**
- ✅ `BillingNav` → `Tabs`. `PageHeader` + intro text kept.
- ✅ POS layout `grid lg:grid-cols-[1fr_360px]` retained; **compose** shared `Input`/`Select`/
  `Button`/`Badge` for the lines table, search results popover (use `shadow-md` list), mode toggle,
  payment-mode chips (selected = `bg-primary text-primary-foreground`).
- ✅ Replace inline `bg-amber-50/text-amber-800`, `bg-red-50/text-red-700`, `text-green-700`,
  `bg-foreground text-background` with semantic tokens / `Badge` / primary `Button`. Result banners
  → toast + a kept on-page receipt block.
- ✅ Totals panel: `formatMoney` everywhere; keep **all** paise math in `preview.ts` and the
  server actions byte-for-byte.
- ✅ **Print:** keep `[data-print-receipt]` templates and the `@media print` isolation **untouched**;
  only restyle the surrounding controls (Print `Button`, size → `Select`).
- ⚠️ If you spot a totals/tax/stock discrepancy vs. server, **flag it** — do not edit the math.

**`(admin)/ledger` + `CustomerForm` + `nav` + `ledger/[id]` + `LedgerActions`**
- ✅ `LedgerNav` → `Tabs`. Directory: `PageHeader`; create-customer form gated by `customers.write`
  (keep) → `Dialog` or inline `FormField`s. `DataTable`; aging columns `formatMoney`,
  **`60+` → `destructive` Badge/emphasis** when > 0 (keep current logic).
- ✅ Statement: aging tiles → `StatCard` (`tone` for 60+/outstanding); statement `Table`;
  credit amounts keep green emphasis via `success` token. Record-payment + reminder controls (gated
  by `ledger.write`) → shared form + `Button`; results → toast. Keep `getStatement`/`aging`.

**`(admin)/orders` + `FulfilButtons`**
- ✅ `PageHeader` "Order queue"; status filter row → `Tabs` (link-mode) with human labels.
- ✅ `DataTable`; **Status** + **Payment** cells → `Badge` per §6 map (replace the generic
  `rounded-full border` pill); total via `formatMoney`. `FulfilButtons` → shared `Button`s
  (single next action), `isLoading`, success/failure toast. Keep the accept→pack→dispatch→complete
  route handlers and pakka-on-dispatch behavior **unchanged**.

**`(admin)/reports` (day-end) + `nav` + `reports/sales` + `reports/valuation` + `reports/gstr1`**
- ✅ `ReportsNav` → `Tabs`. Each report: `PageHeader` + date/range form (`Input type=date` +
  `Button`). KPI tiles → `StatCard`; breakup tables → `Table` with `formatMoney`/`tabular-nums`;
  `EmptyState` for no-data days. GSTR-1: dense `DataTable`, monospace IDs, export button styled.
  Keep all aggregation calls and the "kacha excluded" semantics.

**`(admin)/settings` + `SettingsForm`**
- ✅ `PageHeader`; read-only view → definition list in a `Card`; editable form → `FormField`s
  grouped in `Card` sections (store identity, tax/place-of-supply, invoice numbering, delivery,
  reservation TTL). Save → `Button isLoading` + toast. Keep `settings.write` gating and the
  uninitialized-config message; **do not** change which fields write.

**`(admin)/audit`**
- ✅ `PageHeader`; filter bar → shared `Input`/`Select`/`Button`; `DataTable`; action → neutral
  `Badge`; details JSON in a `font-mono text-xs` truncated cell with a `Dialog`/expand to view full.
  `EmptyState`; "Next page →". Read-only — keep it read-only.

### STOREFRONT — `apps/storefront`

**`layout.tsx` + `Header.tsx` (+ Footer NEW)**
- ✅ Header per §3.2 (logo, nav, search, **cart count `Badge`**, mobile `Sheet`). Keep `useCart`.
- ✅ Add footer; mount `<Toaster />` once.

**`page.tsx` — Catalog (home)**
- ✅ `PageHeader`/hero "Catalog"; search → `Input` + `Button`. Product grid → `Card` per product
  (`hover:shadow-md` lift), name link, brand/SKU meta, price via `formatMoney`, **stock badge** →
  `Badge` (`success` In stock / `destructive` Out of stock) instead of `text-green-700`. `EmptyState`
  + styled "Next →". Roomy retail spacing. Keep `listProducts` projection.

**`products/[id]` + `AddToCart`**
- ✅ Back link, `text-2xl` title, brand/SKU meta. Stock line → `Badge`. Sale-units list → `Card`
  with a clean `divide-y` rows table; price `formatMoney`; "whole only" → `Badge variant="outline"`.
  `AddToCart` → unit `Select` + qty `Input` + primary `Button`; add-to-cart success → toast. Keep
  GST/HSN note and the cart-store wiring.

**`cart/page.tsx` + `CartStore`**
- ✅ `PageHeader` "Your cart"; lines in a `Card`/`Table`; qty `Input`, remove → `Button
  variant="ghost"`/destructive; line + item totals via `formatMoney` (`tabular-nums`). Empty →
  `EmptyState` with "Browse the catalog". Sticky/clear **Proceed to checkout** primary `Button`
  (replace `bg-foreground`). Keep the localStorage cart logic.

**`checkout/page.tsx`**
- ✅ Two-column on desktop (`form` + sticky **order summary** `Card`), single column mobile.
  Fulfilment/payment as labeled radio groups (or segmented `Button`s); address `Select`; GSTIN
  `Input` (labeled). Summary uses `formatMoney`; out-of-stock warning → inline alert + disabled
  submit. Empty-cart and signed-out states → styled `EmptyState` with action. Place-order →
  `Button isLoading`. **Keep** the `/api/cart` re-price, the `Idempotency-Key`, the Razorpay
  hand-off, and `clear()`/redirect flow exactly.

**`orders/page.tsx` + `orders/[id]` + `OrderActions`**
- ✅ List: `PageHeader`; order rows in a `Card`/`Table`; **status → `Badge`** per §6 (human labels);
  total `formatMoney`; date `formatDateTime`. Empty → `EmptyState`.
- ✅ Detail: `PageHeader` with order no; status `Badge`; lines `Table`; totals `formatMoney`;
  timeline of fulfilment; pay-now / cancel / reorder in `OrderActions` → shared `Button`s, cancel
  behind a `Dialog` confirm, results → toast. Keep ownership scoping + the cancel/reorder actions.

**`account/page.tsx` + `AccountClient` + `AuthForms`**
- ✅ Signed-out: `AuthForms` (login / register / reset) in `Tabs` or stacked `Card`s; `FormField`s;
  `Button isLoading`; errors inline + toast on success. Signed-in: profile + addresses as `Card`s;
  add/edit address → `Dialog` form; default-address indicator → `Badge`. Keep all auth/profile/
  address API calls and validation behavior.

---

## 9. Definition of done (per screen)

A screen is "polished" when: it opens with `PageHeader`; uses only `@hardware/ui` components and
semantic tokens (no raw `gray/green/red/amber` palette, no bespoke input className strings); money/qty
go through the §2.5 helpers; it has proper **empty / loading / error / forbidden** states; mutations
give **toast** feedback and submit buttons show **loading**; it is responsive (mobile → desktop) and
keyboard/AX-clean per §7; and **every existing data flow, permission check, and action behavior is
byte-for-byte preserved**. Validate with `pnpm typecheck && pnpm lint && pnpm --filter @hardware/core
test`. Never `pnpm build`.
