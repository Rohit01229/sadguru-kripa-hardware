# Hardware Store — Runbook

How to set up, run, and use the app. Two web apps share one database:

| App            | URL (dev)               | Who uses it                         |
| -------------- | ----------------------- | ----------------------------------- |
| **Storefront** | http://localhost:3000   | Customers (browse, cart, order)     |
| **Admin**      | http://localhost:3001   | Shop owner & staff (POS, stock, etc.) |

> The whole thing is a **web app used mainly on phones at the counter** and by customers. Every screen works on mobile.

---

## 1. First: set up Cloudinary (for product photos)

Product photos are stored on **Cloudinary** (free plan is plenty). Do this once. Until it's set up, the app still works — products just show a placeholder icon instead of a photo, and the "Upload images" button is disabled.

### 1a. Create the account
1. Go to **https://cloudinary.com** and click **Sign up** (Google/GitHub sign-in is fastest). The free plan is fine.
2. After signing in you land on the **Dashboard**. Near the top you'll see **Product Environment Credentials** with a **Cloud name** (something like `dxab12cyz`). **Copy the Cloud name** — you'll need it.

### 1b. Create an "unsigned" upload preset
This lets the admin app upload photos straight to Cloudinary without exposing any secret.

1. Click the **gear / Settings** icon (top right) → in the left menu open **Upload** → scroll to **Upload presets**.
2. Click **Add upload preset**.
3. Set **Signing Mode** to **Unsigned**. *(This is the important part.)*
4. Give it a name, e.g. `hardware_products`. *(Optional: set **Folder** to `products` to keep photos tidy.)*
5. Click **Save**. **Copy the preset name.**

### 1c. Put the keys in the app
Open the file **`apps/admin/.env`** and fill these two lines (only the **admin** app needs them):

```
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="your-cloud-name"
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET="hardware_products"
```

- Use the **Cloud name** from step 1a and the **preset name** from step 1b.
- The storefront needs **nothing** here — it just displays the photos.

### 1d. Restart the admin app
These values are read when the app starts, so after editing `.env`:

- Stop the admin dev server (Ctrl-C in its terminal) and start it again — see [§3](#3-run-the-app).

Done. Now in the admin **Catalog → New product** (or an existing product's page) you'll have a working **Upload images** button. The first image you add is the "primary" one shown in lists and on the storefront.

---

## 2. One-time setup (fresh machine)

**Prerequisites:** Node **22** (see `.nvmrc`) and **pnpm** (`npm install -g pnpm`). A hosted Postgres database (already configured — Neon).

```bash
# 1. Install dependencies
pnpm install

# 2. Generate the database client
pnpm --filter @hardware/db db:generate

# 3. Apply the database schema (creates all tables)
pnpm --filter @hardware/db db:migrate

# 4. Seed the owner login + roles (required to log in)
pnpm --filter @hardware/db db:seed

# 5. (Optional) Load a realistic demo catalog — 10 hardware products with
#    units, brands, categories, price slabs and opening stock.
pnpm --filter @hardware/db db:seed:demo
```

> **Database env:** connection strings live in `packages/db/.env` (`DATABASE_URL` = pooled, `DIRECT_URL` = direct). App env lives in `apps/admin/.env` and `apps/storefront/.env`. See `.env.example` for the full list.

---

## 3. Run the app

Both apps at once (from the repo root):

```bash
pnpm dev
```

Or run them individually in separate terminals:

```bash
pnpm --filter admin dev        # http://localhost:3001
pnpm --filter storefront dev   # http://localhost:3000
```

Then open the URLs above in a browser.

### Log in to the admin
- **URL:** http://localhost:3001
- **Email:** `owner@hardware.local`
- **Password:** `ChangeMe!123`  *(the seed default — change it in production via `SEED_OWNER_PASSWORD`)*

### Language
Every screen has an **EN / हिं** switcher in the top bar (English ↔ Hindi). It remembers your choice. Product names and other data you type are **not** translated — only the app's labels and buttons.

---

## 4. Using the admin (day-to-day)

### Catalog (`/catalog`)
- **New product:** name, SKU, category, brand, HSN code, GST rate, cost, and a **base unit** plus one or more **sale units** (e.g. sell cement by *bag*, wire by *coil* or *metre*). Mark one sale unit as the **default**.
- **Photos:** add product images (needs Cloudinary — [§1](#1-first-set-up-cloudinary-for-product-photos)). First image is primary.
- **Price slabs:** quantity-break pricing (e.g. ₹410/bag from 50 bags, ₹400 from 100).
- **Masters:** manage categories, brands, and units under **Catalog → Masters**.
- **Bulk import:** **Catalog → Import** loads products + opening stock from a CSV/Excel file.

### Stock (`/stock`)
- **On-hand view**, stock **movements** history, **near-expiry** list.
- **GRN (goods receipt):** record stock coming in from a **supplier** (`/stock/grn`, `/stock/suppliers`).
- **Adjustments:** manual +/- corrections with a reason.
- Low-stock alerts fire against each product's **reorder level**.

### Billing / POS (`/billing`)
The counter till. Add items fast by search, pick the sale unit and quantity, apply line/bill discounts or a manual rate override, and take payment (cash + change, UPI, card, or **khata**/credit).
- **Kacha bill:** quick no-tax slip. Leaves only a stock movement; one click **converts to Pakka** before you finalise.
- **Pakka bill:** full **GST tax invoice** with gapless numbering, HSN, and CGST/SGST or IGST by place-of-supply.
- **Invoices** (`/billing/invoices`): reprint (thermal / A4 / A5), **cancel**, or raise a **credit note** (returns).

### Khata / Ledger (`/ledger`)
Customer credit accounts: outstanding balances, **dues aging**, record payments, and send reminders.

### Orders (`/orders`)
Online orders from the storefront. Move each through **accept → pack → dispatch → complete**. A pakka invoice is generated on dispatch.
> **Payments:** online payment (Razorpay) is **turned off for now** — every online order is **pay-at-store / on-delivery**. Mark them paid from the order screen. (The payment code is dormant, not deleted, so it can be switched back on later.)

### Reports (`/reports`)
- **Sales** (by day / item / category / payment mode), **day-end summary**.
- **Stock valuation**.
- **GSTR-1 + HSN summary** export for GST filing.

### Settings (`/settings`)
Shop **name** (shown in both apps and on invoices), GSTIN, home state (place-of-supply), address, bank details, invoice terms, delivery fee + free-delivery threshold, reservation timeout, rounding mode. **Change the shop name here** — it updates the storefront, the admin title, and the login screen.

### Audit (`/audit`)
A log of every sensitive action (who did what, when) for accountability.

---

## 5. Using the storefront (customer side)

Browse the catalog with **search + filters** (category, brand, price, in-stock) and sorting → open a product (photos, unit options, live stock) → **add to cart** → **checkout**. At checkout the customer picks **delivery or store pickup**, chooses a saved address, optionally enters a **GSTIN**, and places the order. Payment is **pay at store / on delivery**. Customers can **register → verify email → log in**, and see their **order history** and addresses under **Account**.

---

## 6. Good to know

- **Razorpay is disabled** (see Orders above). To re-enable later: restore the payment selector in `apps/storefront/app/checkout/page.tsx`, add TEST keys to env, and re-add the Razorpay routes.
- **Background jobs** exist for reservation expiry, khata reminders, day-end roll-up, stock/expiry alerts, and encrypted backups (wire them to a scheduler like Vercel Cron / QStash in production).
- **Demo data:** the `db:seed:demo` catalog is safe to re-run (idempotent). Any old test products (e.g. "Smoke Widget") can be archived from the catalog — just say the word and they can be cleaned up.
- **Reset a stuck dev server (Windows):** if port 3000/3001 stays busy after stopping, find and kill it:
  ```powershell
  Get-NetTCPConnection -LocalPort 3000,3001 | Select-Object -Expand OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
  ```

---

## 7. Toward production (checklist, not done yet)

- Pick hosting (Vercel or a VPS), a domain + TLS, and set production env/secrets.
- Change the owner password (`SEED_OWNER_PASSWORD`) and fill **Settings** (GSTIN, logo, bank, home state).
- Turn on the backup schedule and the background jobs.
- Do a UAT pass with the shop owner and hand over / train staff.
