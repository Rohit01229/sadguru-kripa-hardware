# API Design

**Status:** DRAFT · 2026-06-24
How the admin and storefront apps talk to the backend: the API style, shared conventions, auth, validation, idempotency, and the full endpoint catalog with representative request/response examples.

> Scope note: this is the API contract. Module internals (UoM maths, stock-transaction model, gapless numbering, kacha-zero-trace mechanics) live in `03-technical-architecture.md`; AuthN/Z and payment-security detail in `07-security-architecture.md`; roles and the permission matrix in `10-rbac.md`. This doc references those rather than restating them.

---

## 1. API approach

This is a **modular monolith** on Next.js App Router. There is **no separate API server** — the API lives inside `apps/admin` and `apps/storefront`, both importing the same `@hardware/core` (domain logic) and `@hardware/db` (Prisma). Two complementary mechanisms carry traffic:

| Mechanism | Path / form | Use it for | Why |
|-----------|-------------|------------|-----|
| **Route handlers** (`app/api/**/route.ts`) | REST-style resource endpoints returning JSON | Reads (`GET`), programmatic mutations, anything an external caller hits (Razorpay webhook), anything the client fetches as data (search, autocomplete, live stock), CSV import upload | Stable, cacheable, testable contract; works for fetch from client components and future external integrations |
| **Server actions** (`'use server'`) | Function invoked from a form / client component | Form-driven mutations within our own UI — create product, save GRN, finalize pakka bill, place order, record khata payment | No hand-written fetch/serialization; progressive enhancement; type-safe end-to-end; CSRF handled by the framework |

**Rule of thumb:** _our own UI mutating our own data → server action; anything consumed as a JSON resource, polled, scanned, or called by a third party → route handler._ Both paths run the **same Zod schema and the same `@hardware/core` service function**, so the validation and business rules are identical regardless of entry point. The endpoint catalog below is written REST-style for clarity; entries tagged **(action)** are normally implemented as server actions, **(route)** as route handlers. Where a mutation is both used in-UI and needs an external/programmatic contract, it exists as both, sharing one core service.

Both apps are independently deployable but share one database and one rule set — see `02-solution-architecture.md` for the module map.

---

## 2. Conventions

- **Transport:** JSON over HTTPS only. `Content-Type: application/json` for bodies; `multipart/form-data` only for file upload (CSV/Excel import, product images).
- **Versioning:** API is **internal/first-party**, so no URL version prefix in v1. The Razorpay webhook path is pinned (`/api/webhooks/razorpay`). If we ever expose a public API, introduce `/api/v1/…` then. **TBD:** public-API surface.
- **Field naming:** `camelCase` in JSON bodies and query params (matching the TypeScript/Prisma layer). DB columns may be `snake_case`; the mapping is Prisma's concern, not the wire's.
- **Money = integer paise.** All amounts (`price`, `amount`, `taxAmount`, `total`) are **integers in paise** (₹1 = `100`). No floats for money anywhere on the wire or in the DB. The UI formats `₹` and the decimal point. This avoids rounding drift in GST splits and bulk-slab maths.
- **Quantities = decimal strings.** Measured units (metre, kg, litre) carry decimals; piece-type units are whole. Quantities are sent as **strings** (e.g. `"2.5"`) to preserve precision and are validated against the unit's `allowDecimal` flag (see UoM, `03-technical-architecture.md`).
- **Timestamps = UTC ISO-8601** (`2026-06-24T10:32:00Z`). The client renders IST (UTC+5:30). DB stores `timestamptz`.
- **HTTP status codes:**

| Code | Meaning in this API |
|------|---------------------|
| `200 OK` | Successful read or in-place mutation |
| `201 Created` | Resource created (product, GRN, pakka bill, order) |
| `202 Accepted` | Accepted for async processing (CSV import job, queued notification) |
| `204 No Content` | Successful delete-like op with no body (rare — we soft-delete/cancel, not hard-delete) |
| `400 Bad Request` | Zod validation failure (see error envelope) |
| `401 Unauthorized` | No / invalid session |
| `403 Forbidden` | Authenticated but lacks permission (see `10-rbac.md`) |
| `404 Not Found` | Resource missing or not visible to caller |
| `409 Conflict` | Idempotency replay mismatch, optimistic-lock clash, **insufficient/over-sold stock**, duplicate unique key |
| `422 Unprocessable Entity` | Well-formed but violates a business rule (e.g. cancel an already-cancelled invoice, negative-stock policy block) |
| `429 Too Many Requests` | Rate limit tripped (includes `Retry-After`) |
| `500` / `503` | Unhandled error / dependency (DB, Razorpay) down |

- **Standard error envelope** — every non-2xx returns this shape (success responses return the resource directly, not wrapped):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "One or more fields are invalid.",
    "details": [
      { "path": "saleUnits.0.conversionFactor", "issue": "must be greater than 0" }
    ],
    "requestId": "req_01J8Z9..."
  }
}
```

`code` is a stable machine string (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `IDEMPOTENCY_MISMATCH`, `STOCK_INSUFFICIENT`, `RULE_VIOLATION`, `RATE_LIMITED`, `INTERNAL`). `details` is present for validation errors (mapped from Zod's `issues`). `requestId` correlates to logs/Sentry.

- **Cursor pagination** for all list endpoints (no offset/limit — stable under inserts, cheap on Postgres):

```
GET /api/products?limit=50&cursor=eyJpZCI6ImNr…&q=cement&category=cement
```
```json
{
  "data": [ /* … */ ],
  "pageInfo": { "nextCursor": "eyJpZCI6ImNr…", "hasNextPage": true }
}
```
Default `limit` 50, max 200. Cursor is an opaque base64 of the sort key (`id` or `createdAt,id`). `nextCursor` is `null` on the last page.

- **Sorting / filtering:** explicit query params per endpoint (`q` for full-text via `pg_trgm`, `category`, `brand`, `inStock`, `from`/`to` date range). Unknown params are ignored, not errors.
- **Search:** `GET /api/products?q=` uses Postgres FTS + `pg_trgm` (see `01-tech-stack.md`) — fine for ≤5k SKUs.

---

## 3. Authentication

Auth is **Auth.js v5 (NextAuth)** with httpOnly secure-cookie sessions and the Prisma adapter (`packages/auth`). Full detail in `07-security-architecture.md`; the API-relevant facts:

- **Two distinct principal types, two cookies, never crossed:**
  - **Staff** (Owner/Admin in v1) — authenticate against `apps/admin`. Required for every admin/billing/stock/report/order-fulfilment endpoint.
  - **Customers** — separate accounts on `apps/storefront`; email/password. Required for cart, checkout, order history.
  - A customer session can **never** satisfy a staff-only endpoint and vice-versa — they are different user tables and different cookie scopes. See `10-rbac.md` (separation of accounts).
- **Session = cookie**, not a bearer token. Client `fetch` calls are same-origin and send the cookie automatically; server actions read the session server-side.
- **Authorization** is checked server-side on every mutation via a permission guard in `@hardware/core` (`requirePermission(session, 'bill.pakka.create')`). Middleware does coarse route gating; the guard is the real check. **Never trust the client.** Matrix and enforcement: `10-rbac.md`.
- **Public (no auth)** endpoints: storefront catalog browse/search, product detail, live-stock read, and the Razorpay webhook (authenticated by **signature**, not session). Everything else requires a session.

---

## 4. Request validation (Zod)

Every endpoint validates input with a **Zod schema defined once** (in `@hardware/core`) and reused by both the server action and the route handler, and again for the client form. Rules:

- Parse at the boundary; reject with `400` + the error envelope (`details` from `zodError.issues`).
- Money fields: `z.number().int().nonnegative()` (paise). Quantity fields: `z.string().regex(...)` then domain-checked against the unit's `allowDecimal`.
- Never pass unvalidated body straight to Prisma. Validated, narrowed DTOs only.
- Output is also typed (the core service returns a typed DTO), so responses are predictable.

---

## 5. Idempotency

Money-moving and stock-moving creates are **idempotent** to survive retries, double-clicks, and webhook re-delivery.

- Client sends an **`Idempotency-Key`** header (a UUID it generates) on: **create pakka bill**, **convert kacha→pakka**, **place order**, **record payment**, **issue credit note**.
- Server stores `(key, principalId, route, requestHash) → response` in an `idempotency_keys` table with a TTL (24h). On replay with the **same key + same body**, return the **stored response** (same status). Same key + **different** body → `409 IDEMPOTENCY_MISMATCH`.
- The **Razorpay webhook** is idempotent on the Razorpay `event.id` (and payment/order id) — we record processed event ids and no-op on re-delivery. Razorpay retries failed webhooks, so this is mandatory.
- **Kacha create is NOT idempotent in the bill sense** because **no bill is persisted** — only a stock decrement occurs (see §7 Billing). The decrement itself is wrapped in the stock-transaction model (`03-technical-architecture.md`); the client guards against double-submit in UI, but there is no server-side bill record to dedupe against.

---

## 6. Rate limiting

- Enforced at the edge/middleware using **Upstash (Redis) sliding-window** counters (free tier; see `01-tech-stack.md`). Detail and DoS posture in `06-network-architecture.md` / `07-security-architecture.md`.
- Buckets (initial, **TBD** exact numbers):
  - **Auth endpoints** (login, register, password reset): strict — e.g. 5/min/IP + per-account lockout backoff.
  - **Storefront search/browse**: generous per-IP.
  - **Mutations** (orders, payments): moderate per-session.
  - **Razorpay webhook**: not user-rate-limited; protected by signature + idempotency.
- `429` responses carry `Retry-After`.

---

## 7. Endpoint catalog

Grouped by module. **(route)** = REST route handler, **(action)** = server action (form mutation), **(both)** = exists as both sharing one core service. `🔒S` = staff session required, `🔒C` = customer session required, `🌐` = public. Permissions in brackets map to `10-rbac.md`.

### Auth
| Method · Path | Auth | Notes |
|---|---|---|
| `POST /api/auth/[...nextauth]` (route) | 🌐 | Auth.js handler — credentials sign-in for staff & customers (separate providers/scopes) |
| `POST /api/customer/register` (route) | 🌐 | Storefront sign-up; email verification sent |
| `POST /api/customer/verify-email` (route) | 🌐 | Token from email |
| `POST /api/customer/password/reset-request` (route) | 🌐 | Rate-limited |
| `POST /api/customer/password/reset` (route) | 🌐 | Token + new password |
| `GET /api/me` (route) | 🔒S/🔒C | Current principal + permissions (admin) or profile (customer) |

### Catalog / Products
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/products` (route) | 🌐 | List/search; `q`, `category`, `brand`, `inStock`; cursor-paginated. Storefront-safe fields only when unauthenticated |
| `GET /api/products/{id}` (route) | 🌐 | Detail incl. sale units + live stock |
| `POST /api/products` (both) | 🔒S `[products.create]` | Create product with base + sale units (example §8.1) |
| `PATCH /api/products/{id}` (both) | 🔒S `[products.update]` | Edit attributes/units/pricing |
| `POST /api/products/{id}/archive` (action) | 🔒S `[products.update]` | Soft-disable (no hard delete) |
| `GET /api/categories` (route) | 🌐 | Category tree |

### Units / UoM
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/units` (route) | 🔒S | Master unit list (base + sale unit defs) |
| `POST /api/products/{id}/sale-units` (action) | 🔒S `[products.update]` | Add a sale unit + conversion factor + per-unit price |
| `PATCH /api/products/{id}/sale-units/{unitId}` (action) | 🔒S `[products.update]` | Edit factor/price/`allowDecimal` |

> UoM model (one base unit, N sale units, conversion factors, decimal vs whole) is defined in `03-technical-architecture.md`. The API just exposes it.

### Stock & GRN
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/stock` (route) | 🔒S `[stock.read]` | On-hand per product (base unit), low-stock flag |
| `POST /api/grn` (both) | 🔒S `[stock.grn]` | Goods-received → stock-in, optional batch/expiry (example §8.2) |
| `POST /api/stock/adjustments` (action) | 🔒S `[stock.adjust]` | Manual adjust + reason (damage/wastage/count); opening stock |
| `GET /api/stock/movements` (route) | 🔒S `[stock.read]` | Movement ledger; `productId`, `from`/`to`. **Kacha decrements appear here as unattributed stock-out** |
| `POST /api/stock/returns` (action) | 🔒S `[stock.adjust]` | Sales/purchase return → stock-in |
| `GET /api/stock/near-expiry` (route) | 🔒S `[stock.read]` | Batches nearing expiry |

### Suppliers
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/suppliers` (route) | 🔒S `[suppliers.read]` | List |
| `POST /api/suppliers` (both) | 🔒S `[suppliers.write]` | Create |
| `PATCH /api/suppliers/{id}` (action) | 🔒S `[suppliers.write]` | Edit |
| `GET /api/suppliers/{id}/dues` (route) | 🔒S `[suppliers.read]` | Payables (nice-to-have). POs are **future** — not in v1 |

### Pricing
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/products/{id}/price?qty=&unitId=` (route) | 🌐 | Resolve effective unit price for a quantity, applying **bulk slabs** (visible to all) |
| `POST /api/products/{id}/price-slabs` (action) | 🔒S `[pricing.write]` | Define quantity-break slabs per sale unit |
| `PATCH /api/products/{id}/price-slabs/{slabId}` (action) | 🔒S `[pricing.write]` | Edit slab |

### Billing — Kacha
| Method · Path | Auth | Notes |
|---|---|---|
| `POST /api/billing/kacha/decrement` (action) | 🔒S `[bill.kacha.create]` | **ZERO TRACE.** Validates lines, applies UoM conversion, decrements stock **only**. **Persists NO bill, value, cash, customer, or tax.** Returns an **ephemeral, non-persisted** estimate payload for printing (example §8.4 shows the convert path). Footprint = stock movement marked `UNATTRIBUTED_OUT` |
| `POST /api/billing/kacha/convert` (both) | 🔒S `[bill.pakka.create]` | **Convert the in-memory kacha cart → a saved pakka tax invoice** before finalize. Reverses nothing (kacha didn't persist); creates the pakka bill with full GST. **Idempotent** (example §8.4) |

> The kacha cart lives **client-side / in transient session state**, never in the bills table. "Convert" simply submits that cart to the pakka-create path. See `03-technical-architecture.md` (kacha-zero-trace) for why no server row exists.

### Billing — Pakka (full GST tax invoice)
| Method · Path | Auth | Notes |
|---|---|---|
| `POST /api/billing/pakka` (both) | 🔒S `[bill.pakka.create]` | Create saved tax invoice: GSTIN, HSN per line, **CGST/SGST or IGST** by place-of-supply, **gapless number**, per-line **manual rate override**, line/bill discount, round-off, payment mode (cash/UPI/card/khata) incl. part-payment. **Idempotent** (example §8.3) |
| `GET /api/billing/pakka` (route) | 🔒S `[bill.read]` | List invoices; `from`/`to`, `paymentMode`, `customerId` |
| `GET /api/billing/pakka/{id}` (route) | 🔒S `[bill.read]` | Invoice detail (for reprint A4/A5/thermal) |
| `POST /api/billing/pakka/{id}/cancel` (action) | 🔒S `[bill.cancel]` | **Cancel** (no delete — gapless numbering preserved). Reason required; reverses stock + ledger; writes audit/void log |
| `POST /api/billing/pakka/{id}/credit-note` (both) | 🔒S `[bill.creditnote.create]` | Credit note referencing original invoice; partial returns; refund as cash/UPI/khata-adjust. Own gapless CN series. **Idempotent** |

### Khata / Ledger
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/customers` (route) | 🔒S `[customers.read]` | Counter-customer directory (distinct from storefront accounts) |
| `POST /api/customers` (action) | 🔒S `[customers.write]` | Create counter customer (name/phone/GSTIN) |
| `GET /api/ledger/{customerId}` (route) | 🔒S `[ledger.read]` | Outstanding, statement, **aging buckets** |
| `POST /api/ledger/{customerId}/payments` (both) | 🔒S `[ledger.write]` | Record a khata receipt (part-payment) against outstanding; mode cash/UPI/card. **Idempotent** |
| `POST /api/ledger/{customerId}/reminders` (action) | 🔒S `[ledger.write]` | Trigger SMS/email dues reminder (via QStash) |

### Orders — Storefront (customer)
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/cart` (route) | 🔒C | Current cart |
| `POST /api/cart/items` (action) | 🔒C | Add/update line (sale unit + qty, step-validated) |
| `DELETE /api/cart/items/{id}` (action) | 🔒C | Remove line |
| `POST /api/orders` (both) | 🔒C `[orders.place]` | **Place order → atomically RESERVES stock** with a reservation timeout; delivery (local) or pickup; flat fee free above threshold; GSTIN optional; payment intent (Razorpay) or pay-at-store/on-delivery. **Idempotent** (example §8.5). `409 STOCK_INSUFFICIENT` if reservation fails |
| `GET /api/orders` (route) | 🔒C | Customer order history |
| `GET /api/orders/{id}` (route) | 🔒C | Status + items |
| `POST /api/orders/{id}/cancel` (action) | 🔒C `[orders.cancel.own]` | Cancel before dispatch → **releases reservation** |

### Orders — Admin fulfilment (staff)
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/admin/orders` (route) | 🔒S `[orders.read]` | Queue; filter by status |
| `POST /api/admin/orders/{id}/accept` (action) | 🔒S `[orders.fulfil]` | Owner confirms → `ACCEPTED` |
| `POST /api/admin/orders/{id}/pack` (action) | 🔒S `[orders.fulfil]` | → `PACKED` |
| `POST /api/admin/orders/{id}/dispatch` (both) | 🔒S `[orders.fulfil]` | → `DISPATCHED`; **final stock deduction (converts reservation) + generates the pakka invoice** at hand-over |
| `POST /api/admin/orders/{id}/complete` (action) | 🔒S `[orders.fulfil]` | → `COMPLETED` |

> Order lifecycle `PLACED → ACCEPTED → PACKED → DISPATCHED → COMPLETED` (with `CANCELLED`). Reservation→deduction transition is in `03-technical-architecture.md`.

### Payments / Razorpay
| Method · Path | Auth | Notes |
|---|---|---|
| `POST /api/payments/razorpay/order` (action) | 🔒C | Create a Razorpay order for an app order; returns `razorpayOrderId` + key for hosted checkout |
| `POST /api/webhooks/razorpay` (route) | 🌐 (signature) | **Razorpay webhook.** Verifies `X-Razorpay-Signature` (HMAC-SHA256 over raw body); idempotent on `event.id`; marks payment captured/failed and advances order. Card data never touches us (example §8.6) |

### Reports / GSTR-1 export
| Method · Path | Auth | Notes |
|---|---|---|
| `GET /api/reports/sales` (route) | 🔒S `[reports.read]` | By day/item/category/payment mode |
| `GET /api/reports/day-end` (route) | 🔒S `[reports.read]` | Day-end summary (pakka only; kacha is untracked) |
| `GET /api/reports/gstr1?period=YYYY-MM` (route) | 🔒S `[reports.export]` | **GSTR-1 export** (B2B / B2C / credit notes) + **HSN summary** for filing. JSON or CSV (`?format=csv`) |
| `GET /api/reports/stock-valuation` (route) | 🔒S `[reports.read]` | On-hand valuation |

### Import (CSV/Excel)
| Method · Path | Auth | Notes |
|---|---|---|
| `POST /api/import/catalog` (route, multipart) | 🔒S `[products.create]` | Upload CSV/Excel of catalog + opening stock → returns `202` + `jobId`; processed async (QStash) |
| `GET /api/import/jobs/{jobId}` (route) | 🔒S `[products.create]` | Import status, row-level errors |

> **e-Way bill** generation (>₹50k) is a **nice-to-have** — endpoint **TBD**. **e-Invoice/IRN** is **deferred** (turnover < ₹5 cr) — no endpoint in v1.

---

## 8. Representative request/response examples

All money in **paise**; quantities as decimal strings; timestamps UTC. Success bodies return the resource directly; errors use the envelope from §2.

### 8.1 Create product with sale units — `POST /api/products`
**Request**
```json
{
  "name": "Finolex 2.5 sq mm FR Wire",
  "brand": "Finolex",
  "sku": "FNX-WIRE-2.5",
  "hsn": "8544",
  "categoryId": "cat_electrical",
  "gstRatePct": 18,
  "baseUnit": { "code": "MTR", "name": "metre", "allowDecimal": true },
  "saleUnits": [
    { "code": "MTR",  "name": "metre", "conversionFactor": "1",   "allowDecimal": true,  "priceMrp": 4500, "priceSale": 4200 },
    { "code": "COIL", "name": "coil (90 m)", "conversionFactor": "90", "allowDecimal": false, "priceMrp": 360000, "priceSale": 351000 }
  ],
  "costPerBaseUnit": 3200,
  "reorderLevel": "100"
}
```
**Response `201`**
```json
{
  "id": "prod_01J8ZA",
  "name": "Finolex 2.5 sq mm FR Wire",
  "sku": "FNX-WIRE-2.5",
  "hsn": "8544",
  "gstRatePct": 18,
  "baseUnit": { "id": "u_mtr", "code": "MTR", "allowDecimal": true },
  "saleUnits": [
    { "id": "su_mtr",  "code": "MTR",  "conversionFactor": "1",  "priceSale": 4200 },
    { "id": "su_coil", "code": "COIL", "conversionFactor": "90", "priceSale": 351000 }
  ],
  "stockOnHandBase": "0",
  "createdAt": "2026-06-24T10:32:00Z"
}
```

### 8.2 Record GRN (stock-in) — `POST /api/grn`
**Request** (`Idempotency-Key: 7c1f…`)
```json
{
  "supplierId": "sup_acme",
  "supplierInvoiceNo": "ACME/26-27/118",
  "receivedAt": "2026-06-24T09:15:00Z",
  "lines": [
    {
      "productId": "prod_01J8ZA",
      "receiveUnitId": "su_coil",
      "quantity": "5",
      "batchNo": "B-2026-06",
      "expiryDate": null,
      "costPerReceiveUnit": 288000
    }
  ]
}
```
**Response `201`** — note `quantity` in the receive unit is converted to base units for stock:
```json
{
  "id": "grn_01J8ZB",
  "supplierId": "sup_acme",
  "lines": [
    { "productId": "prod_01J8ZA", "quantity": "5", "baseQuantityAdded": "450", "batchNo": "B-2026-06" }
  ],
  "stockMovementIds": ["mv_01J8ZB1"],
  "createdAt": "2026-06-24T09:15:04Z"
}
```

### 8.3 Create pakka bill with GST split — `POST /api/billing/pakka`
**Request** (`Idempotency-Key: a91d…`). Intra-state supply (shop & customer both in same state) → CGST+SGST. Line 2 shows a **manual rate override**.
```json
{
  "placeOfSupplyStateCode": "19",
  "shopStateCode": "19",
  "customer": { "name": "Sharma Hardware", "gstin": "19ABCDE1234F1Z5" },
  "lines": [
    { "productId": "prod_01J8ZA", "saleUnitId": "su_mtr", "quantity": "120", "unitPrice": 4200, "discountPct": 0 },
    { "productId": "prod_cement", "saleUnitId": "su_bag", "quantity": "10", "unitPrice": 38000, "rateOverride": 36500, "discountPct": 0 }
  ],
  "billDiscount": 0,
  "roundOff": true,
  "payment": { "mode": "khata", "amountPaid": 0 }
}
```
**Response `201`** — taxes computed per line by HSN/GST rate; CGST = SGST = half of GST; gapless invoice number assigned:
```json
{
  "id": "inv_01J8ZC",
  "invoiceNo": "INV/26-27/000142",
  "invoiceType": "PAKKA",
  "placeOfSupplyStateCode": "19",
  "taxKind": "CGST_SGST",
  "lines": [
    { "productId": "prod_01J8ZA", "quantity": "120", "taxableValue": 504000, "gstRatePct": 18, "cgst": 45360, "sgst": 45360, "lineTotal": 594720 },
    { "productId": "prod_cement", "quantity": "10",  "effectiveUnitPrice": 36500, "taxableValue": 365000, "gstRatePct": 28, "cgst": 51100, "sgst": 51100, "lineTotal": 467200 }
  ],
  "subtotalTaxable": 869000,
  "cgstTotal": 96460,
  "sgstTotal": 96460,
  "igstTotal": 0,
  "roundOff": -20,
  "grandTotal": 1061900,
  "payment": { "mode": "khata", "amountPaid": 0, "balanceToLedger": 1061900 },
  "createdAt": "2026-06-24T11:05:12Z"
}
```
> If `placeOfSupplyStateCode` ≠ `shopStateCode`, `taxKind` is `IGST` and `igstTotal` carries the full GST (no CGST/SGST). Place-of-supply logic: `03-technical-architecture.md`.

### 8.4 Convert kacha → pakka — `POST /api/billing/kacha/convert`
The kacha cart was never persisted (stock may already have been decremented via `/kacha/decrement`, marked unattributed). Conversion submits the cart to the pakka path; if stock was already decremented, the request sets `stockAlreadyDecremented: true` so the pakka create **attributes** the existing movement instead of double-deducting.
**Request** (`Idempotency-Key: c0de…`)
```json
{
  "stockAlreadyDecremented": true,
  "stockMovementRefs": ["mv_kacha_tmp_1"],
  "placeOfSupplyStateCode": "19",
  "shopStateCode": "19",
  "customer": { "name": "Walk-in", "gstin": null },
  "lines": [
    { "productId": "prod_paint", "saleUnitId": "su_litre", "quantity": "4", "unitPrice": 52000 }
  ],
  "payment": { "mode": "cash", "amountPaid": 245440 }
}
```
**Response `201`** — a real, saved pakka invoice now exists (the kacha never did):
```json
{
  "id": "inv_01J8ZD",
  "invoiceNo": "INV/26-27/000143",
  "invoiceType": "PAKKA",
  "convertedFromKacha": true,
  "grandTotal": 245440,
  "payment": { "mode": "cash", "amountPaid": 245440, "changeDue": 0 },
  "createdAt": "2026-06-24T11:12:40Z"
}
```
> Calling `POST /api/billing/kacha/decrement` alone returns an **ephemeral** estimate (`{ "estimate": {…}, "stockMovementRefs": [...] }`) with **no `invoiceNo` and no persisted bill** — by design (zero trace).

### 8.5 Place order (reserves stock) — `POST /api/orders`
**Request** (🔒C, `Idempotency-Key: 0rd3…`)
```json
{
  "fulfilment": { "type": "DELIVERY", "addressId": "addr_home" },
  "lines": [
    { "productId": "prod_01J8ZA", "saleUnitId": "su_mtr", "quantity": "30" }
  ],
  "gstin": null,
  "paymentMethod": "RAZORPAY"
}
```
**Response `201`** — stock atomically reserved with a timeout; awaiting payment + owner accept:
```json
{
  "id": "ord_01J8ZE",
  "status": "PLACED",
  "reservation": { "state": "RESERVED", "expiresAt": "2026-06-24T11:30:00Z" },
  "lines": [ { "productId": "prod_01J8ZA", "quantity": "30", "reservedBaseQty": "30" } ],
  "itemsTotal": 126000,
  "deliveryFee": 5000,
  "grandTotal": 131000,
  "payment": { "method": "RAZORPAY", "razorpayOrderId": "order_Pqr…", "status": "PENDING" },
  "createdAt": "2026-06-24T11:15:00Z"
}
```
**Failure `409`** when stock can't be reserved:
```json
{ "error": { "code": "STOCK_INSUFFICIENT", "message": "Only 12 metre available for Finolex 2.5 sq mm FR Wire.", "requestId": "req_…" } }
```

### 8.6 Razorpay webhook — `POST /api/webhooks/razorpay`
Inbound from Razorpay (no session; verified by signature header). We must read the **raw body** to verify HMAC, then dedupe on `event.id`.
**Request headers/body (excerpt)**
```
X-Razorpay-Signature: 3f8a…   (HMAC-SHA256 of raw body, keyed with webhook secret)
```
```json
{
  "event": "payment.captured",
  "id": "evt_PqrPaymentCaptured",
  "payload": {
    "payment": { "entity": { "id": "pay_Pst…", "order_id": "order_Pqr…", "amount": 131000, "currency": "INR", "status": "captured" } }
  }
}
```
**Response `200`** (always 200 once handled/deduped, so Razorpay stops retrying):
```json
{ "received": true }
```
Server actions on `payment.captured`: verify signature → if `evt_*` already processed, return `200` no-op → else mark the matching order's payment `CAPTURED`, advance order to allow `ACCEPTED`, persist `event.id`. On bad signature → `400` and the event is logged/alerted. Payment-security detail: `07-security-architecture.md`.

---

## 9. Open items (TBD)

- Exact **rate-limit numbers** per bucket (§6).
- **e-Way bill** endpoint shape (nice-to-have, >₹50k consignments).
- Whether **RFQ/quote** and **saved quotation/estimate** get first-class endpoints in v1 or phase-2 (both are nice-to-have in the proposal).
- **Negative-stock policy** wire representation (block vs allow-with-flag) — coordinate with `03-technical-architecture.md`.
- Public/external **API versioning** (`/api/v1`) — only if/when we expose one.
