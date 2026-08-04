# e-Invoice (IRN/QR) & e-Way Bill — Scope

**Status:** e-Way bill **BUILT** (§10); e-invoicing scoped and deliberately deferred. **Date:** 2026-08-04
**Purpose:** decide whether to build GST e-invoicing, and if so, how.
**Sources:** official `*.gst.gov.in`, `einv-apisandbox.nic.in`, `gstn.org.in`, plus notification text via EY/TaxGuru where CBIC's own PDFs were unreachable. Every uncertainty is flagged in §9 rather than smoothed over.

---

## 1. The headline: your shops probably don't need this

**e-Invoicing is mandatory only above ₹5 crore aggregate annual turnover** (Notification 10/2023-CT, effective 1 Aug 2023). That threshold has not moved in three years, and **no reduction is notified** — the ₹1cr/₹2cr figures in trade press are speculation, and the Sep-2025 "GST 2.0" council meeting changed rate slabs, not this.

A hardware shop turning over ₹50 lakh–₹3 crore has **no e-invoicing obligation at all**: no IRN, no IRP QR, no API integration.

Three qualifications that matter:

1. **The test is PAN-level and historical.** Aggregate turnover sums *every* GSTIN under the PAN, includes exempt supplies and exports, and applies if the threshold was crossed in **any** year since 2017-18. Cross it once and the obligation is permanent even if turnover later falls. So "am I under ₹5cr this year?" is the wrong question — a shop with one big year in FY2022-23 is already liable.
2. **Most hardware-shop sales are out of scope anyway.** e-Invoicing covers B2B, SEZ, exports, deemed exports and RCM. **Walk-in B2C is excluded at any turnover.** The separate B2C "Dynamic QR" rule only applies above **₹500 crore** — and that QR is self-generated (UPI ID + bank details), not an IRP artefact.
3. **e-Way bills are the real near-term need.** They apply to *any* consignment over **₹50,000** regardless of turnover. A shop delivering ₹60,000 of cement today needs an e-way bill and does **not** need an e-invoice. **This is the compliance gap your customers actually have.**

> **Recommendation: do not integrate e-invoicing now. Do the data-model work now (§4), and build e-way bill first (§7).**

---

## 2. What e-invoicing actually is

Not "emailing a PDF". You POST a **Form GST INV-01** JSON to an Invoice Registration Portal; it validates, de-duplicates against a central GSTN hash registry, and returns signed artefacts.

**The IRN is a SHA-256 of `SupplierGSTIN + DocType + DocNo + FY`** — deterministic, so **we can compute it ourselves before calling anything and use it as the idempotency key.** That is the single most useful fact in this document.

The IRP returns `Irn`, `AckNo`, `AckDt`, `SignedInvoice` (a JWS), `SignedQRCode` (a *string*, not an image), `Status`, and EWB fields if requested.

**Printing:** the **QR is legally mandatory** (Rule 46(r)). Printing the IRN text is optional per GSTN's FAQ — though IRIS's own portal claims it is required. The two official sources conflict; **print both**, it costs nothing.

**Cancellation is the constraint that bites:**
- **24 hours from IRN generation** (not from invoice date). After that: no cancellation, ever.
- **Full cancel only** — no partial, and **no amendment on the IRP at all**. Corrections go via GSTR-1 amendment or a credit/debit note (themselves IRN-able as `CRN`/`DBN`).
- **A cancelled IRN burns the document number** — it can never be reused (error 2278).
- An active e-way bill **blocks** IRN cancellation (error 2230) — cancel the EWB first.

---

## 3. Architecture: the multi-tenant credential model

This is the question that determines whether a SaaS can do this at all, and the answer is good news with one catch.

**Two independent credential layers:**

| Layer | Scope | Who holds it |
|---|---|---|
| `client_id` + `client_secret` | The **transport identity**. For a GSP/ERP/ECO, ONE pair covers **all** its unrelated taxpayer clients. | Us (once) |
| `username` + `password` | **Per GSTIN, always.** | Each shop, created by them |

✅ **We do NOT need per-shop IRP credentials.** One ERP/GSP relationship serves every tenant.

❌ **But each shop must do a one-time self-service step on the IRP** — log in, *API Registration → Create API User*, select "Through GSP", pick us from a dropdown, set a username/password. **We cannot silently act for a taxpayer.** That consent flow is real product surface, not a footnote, and it will be the #1 onboarding drop-off.

**We cannot become a GSP** — GSTN requires ₹2 crore paid-up capital and ₹5 crore average turnover. We consume one.

**Which IRP:** NIC (`einvoice1/2`) **will not grant direct API access below ₹100 crore**, so NIC-direct is off the table. **IRIS (`einvoice6`) and Clear (`einvoice4`) accept any e-invoicing-enabled taxpayer**, and GSTN confirms **core e-invoice APIs are free of cost** on all six IRPs. Commercial ASP wrappers charge roughly **18–50 paise per IRN** (the only publicly verifiable rates — GSTZen); the major vendors are quote-only.

⚠️ **Hard infrastructure ceiling: production allows a maximum of 4 whitelisted static Indian IPs.** For a serverless app on Vercel that means fixed-egress NAT and **no horizontal scaling of egress past 4 addresses**. This is an architectural constraint, not a config item, and it is the thing most likely to force a design change.

---

## 4. What our data model is missing (do this part now)

Audited against our current schema. This is the expensive, disruptive work — and it is **free to do today** versus re-keying every shop's catalogue later.

| Gap | Today | Needed |
|---|---|---|
| **Unit codes → UQC** | free text: `COIL`, `BUCKET`, `FT` | official 3-letter UQC, IRP-validated |
| **Supplier address** | one free-text `StoreConfig.address` | structured line1/line2/city/**state code**/**PIN** |
| **Buyer address** | `Address` has line1/city/state/pincode ✅ | same, but required for B2B — walk-ins have none |
| **HSN** | `hsnCode String?` (optional) | mandatory; **6-digit above ₹5cr**, 4-digit below |
| **PIN ↔ state validity** | not validated | PIN must belong to the declared state (error 3039) |
| **Document type** | implicit | enum `INV`/`CRN`/`DBN` |
| **IRN storage** | none | `irn`, `ackNo`, `ackDt`, `signedQr`, `irpUsed`, status |

### The UQC problem, concretely

**Free text is not acceptable** — UQC is a controlled vocabulary the IRP validates. Of the 13 units we seed by default, **only 5 are already valid UQCs**:

| Ours | UQC | |
|---|---|---|
| `PCS` `BOX` `BAG` `DOZ` `BDL` | same | ✅ valid |
| `KG` → `KGS`, `G` → `GMS`, `L` → `LTR`, `M` → `MTR`, `ROLL` → `ROL`, `SQFT` → `SQF` | mapped | ⚠️ needs migration |
| `COIL`, `FT` | **no UQC exists** | ❌ must fall back to `OTH`/`NOS` |

→ Add a `uqc` column to `Unit`, seed the mapping, and make it a required field on the unit form. ⚠️ Pull the UQC master **from the portal at build time** — the official MasterCodes page lists 49 entries while secondary guides say 44.

### Two things we already get right
- **Invoice numbers fit.** `2026-27/000124` is 14 chars (limit 16) and uses only `/` and `-`. ✅
- **We never reuse a cancelled number.** `cancelInvoice` sets `status = CANCELLED` in place and `nextInvoiceNo` always increments — so the "burned document number" rule is satisfied by construction. ✅

### One thing we get wrong
**`cancelInvoice` has no time window.** It will cancel any active invoice, any age. Once an invoice carries an IRN, cancelling after 24 hours leaves a **live IRN registered with the government against a bill we consider void**. The fix is a rule we don't have: *if the invoice has an IRN and it is older than 24 h, refuse the cancel and require a credit note instead.*

---

## 5. Where it hooks into our billing flow

**The IRP call must NOT go inside `finalizePakkaTx`.** That transaction holds the gapless-counter row lock; a network call to a third party inside it would hold that lock for the duration of an HTTP round-trip and serialise the entire shop's billing behind an external service that can be slow or down.

**But Rule 48(5) says an invoice issued without an IRN "shall not be treated as an invoice"** — so we cannot legally hand a B2B customer their tax invoice before the IRP responds. That is a genuine tension:

- **Option A — block on the round-trip.** Correct, but couples the till to IRP latency and downtime. Only acceptable for B2B, which is the minority of counter sales.
- **Option B — issue a delivery challan / proforma at the counter, follow with the tax invoice** once the IRN lands. Legally clean, more moving parts.
- ❌ **Not an option: "issue now, get IRN later."** It appears in secondary summaries but contradicts Rule 48(5). The official answer to IRP downtime is **failover to a different IRP**, which is why we must record *which* IRP minted each IRN.

**Concurrency:** NIC documents a race where simultaneous identical requests bypass the duplicate check and produce spurious errors. **Serialise per (GSTIN, document number)** — our existing idempotency infrastructure covers this shape.

**Duplicate IRN is a success, not a failure.** Error `2150` returns the *existing* IRN inside `InfoDtls` (`InfCd: "DUPIRN"`). Parse and persist it; treating it as an error would strand invoices.

**Async worker:** our Vercel-Cron/QStash infrastructure (`lib/cron.ts`) already exists and is the natural home for the retry/backoff queue.

---

## 6. Effort

| Slice | Work | Size |
|---|---|---|
| **E0 — Data model** | UQC on Unit + migration; structured supplier address + PIN; PIN↔state validation; HSN required-when-liable; doc-type enum | **M** — do this now regardless |
| **E1 — E-way bill** | ✅ **DONE** — see §10 | — |
| **E2 — IRP auth** | RSA/AES envelope, token cache (6 h prod / 1 h sandbox), sandbox onboarding | **M** — fiddly crypto, well specified |
| **E3 — IRN generation** | INV-01 builder, deterministic-IRN idempotency, async worker, retries, duplicate handling, IRP failover | **L** |
| **E4 — Print + cancel** | QR on invoice/PDF, 24 h cancel rule, credit-note path | **S–M** |
| **E5 — Tenant onboarding** | Per-shop "authorise us on the IRP" flow + status tracking | **M** — high product-design content |
| **E6 — Infra** | Fixed-egress NAT, ≤4 static IPs, production whitelisting (4–5 days lead) | **M** + external dependency |

**E0 is worth doing now.** Everything from E2 down should wait until a real customer is actually liable.

---

## 7. Recommendation

1. **Build E0 (data model) now.** Capturing UQC, PIN, state code and 6-digit HSN correctly is cheap today and horrible to retrofit across live catalogues.
2. **Build E1 (e-way bill) next.** It is what your customers need *today*, at any turnover, and it does not require IRP credentials or IP whitelisting.
3. **Defer e-invoicing (E2–E6) until a customer crosses ₹5 crore** — or until the threshold drops, which is the single most likely thing on this page to change. Re-check before committing.
4. **When we do build it:** integrate **IRIS or Clear** as the IRP (they accept small taxpayers; core APIs are free), not NIC-direct and definitely not by becoming a GSP.

---

---

## 10. e-Way bill — what was built

Built because it is the compliance gap our shops actually have: an e-way bill is required for any consignment above the state threshold **at any turnover**, whereas e-invoicing only bites above ₹5 crore.

**Deliberately NOT an API integration.** Generating a bill programmatically needs GSP credentials plus production IP whitelisting (§3) — a commercial decision we have not made. So this does everything either side of that call, and is honest about the gap rather than pretending:

1. **Decides whether a bill is needed** — `ewayBillRequired()` compares the consignment against the right threshold: ₹50,000 inter-state (uniform, central), or the state's own intra-state figure. Verified differences are encoded (Bihar, Maharashtra, Tamil Nadu at ₹1 lakh); everything else defaults to ₹50,000, and a shop can override.
   *Bias stated in the code:* when unsure we use the LOWER figure, which warns more often. An unnecessary prompt costs a moment; a missing e-way bill costs a detained vehicle.
2. **Captures Part-A and Part-B** on the invoice page — consignment (from/to state + PIN, distance) and vehicle (mode, number, transporter, over-dimensional flag). Part-B is optional because the law lets a consignment be booked before a vehicle is assigned.
3. **Produces the portal's own upload JSON** (`GET /api/billing/invoices/{id}/eway.json`) so the shopkeeper uploads a file at ewaybillgst.gov.in instead of re-typing the consignment. Field names are the portal's, verbatim.
4. **Records the number and computes validity** — 1 day per 200 km, or per 20 km for over-dimensional cargo, running from **Part-B entry** (Rule 138(10)), not from when the consignment was created.
5. **Blocks what the portal would reject, before the typing** — invoices past the 180-day limit, and cancellation outside the 24-hour window.

### Notable decisions

- **Thresholds are data, not constants.** States change intra-state limits by their own notification with no central announcement (West Bengal moved in June 2026). The UI always shows which threshold it applied, so the number is auditable.
- **UQC mapping shipped early** (`shared/uqc.ts`). Government portals reject free-text units, and our units are shop-friendly ("bag", "coil", "ft"). This translates at the boundary so the shop never types tax codes. Hardware vernacular maps to what it actually means — a *coil* of wire and a *bucket* of paint are counted as units, so `NOS`; linear *feet* has no UQC at all, so it honestly becomes `OTH` rather than a wrong guess. **This is also the mapping e-invoicing will need** (§4), so it is now done.
- **A GENERATED bill is locked.** Once a number exists the portal is authoritative; silently editing our copy would put it out of step with the government's record.
- **The 24-hour cancel check is necessary, not sufficient** — the portal also refuses once a bill has been verified in transit, which we cannot see. Cancel there first.

### Verification

- **26 rules tests** — thresholds (including that a consignment exactly *at* the limit does not need one, since Rule 138 says "exceeds"), validity maths across the 200 km boundaries, over-dimensional cargo, document age, cancel window, and UQC mapping (asserting we only ever emit codes from the official list).
- **End-to-end against the live DB:** a ₹1,07,520 invoice was correctly flagged as requiring a bill; the draft saved; the number recorded; validity computed as 3 days for 450 km; and the portal payload produced with the right doc number, DD/MM/YYYY date, route, totals, vehicle type and — critically — `qtyUnit: "BAG"` mapped from our free-text "bag". The probe invoice was removed and stock restored afterwards.
- `/api/.../eway.json` returns a clear **404 with an actionable message** when no transport details exist yet, not a generic 500.

### Still open

- **No API call.** The shopkeeper uploads the JSON manually. Automating it needs the GSP decision in §3.
- **Supplier address is still one free-text field** — the e-way payload carries it as-is. Structuring it (§4) is the remaining E0 work and is also what e-invoicing will need.
- **The 1 Aug 2026 changes (mandatory Ship-to GSTIN, EWB Closure API) were put on hold on 30 Jul 2026.** Not built to, deliberately.

## 8. Decisions needed from you

1. **Do any current or prospective shops exceed ₹5 crore PAN-level turnover — in any year since 2017-18?** This alone decides whether E2–E6 are needed at all.
2. ~~Should e-way bill move up the queue?~~ **Done — see §10.**
3. **Are we willing to accept the 4-static-IP ceiling** and fixed-egress NAT on Vercel, or does that push us toward a small dedicated egress proxy?
4. **For B2B counter sales, block on the IRP round-trip (A) or issue a challan then the invoice (B)?** Only relevant once we build it.

---

## 9. Open questions — verify before building

Flagged rather than assumed:
1. **Exact text of Notification 10/2023-CT** — CBIC's own PDFs 404'd; verified only via EY/TaxGuru/GSTPress.
2. **Can a genuinely below-₹5cr shop voluntarily enable and generate IRNs?** Portal wording is ambiguous and aimed at those already liable. Matters if a customer *wants* e-invoicing without being obliged.
3. **NIC's direct-API turnover bar** — three official NIC pages say ₹100cr, ₹500cr and ₹5cr. At least two are stale.
4. **Is schema v1.1 still current?** No dated 2026 official confirmation found.
5. **UQC list size** — portal shows 49, secondary guides say 44. Pull from the portal.
6. **e-Way Bill changes announced for 1 Aug 2026** (mandatory Ship-to GSTIN, EWB Closure API) were **put on hold on 30 Jul 2026** — days ago. **Do not build to them.** Genuinely in flux.
7. **API rate limits** — none published, though throttling error codes exist (3108/3109, plus one-hour user blocks). Build backoff regardless.
8. **Production base hostname and sandbox reset policy** — not public; arrive in the onboarding pack.
9. **B2C e-invoicing** — a *voluntary* pilot only (54th Council, Sep 2024). "Full rollout 2026-27" is trade press, not notified.

> Statutory wording here is quoted via IRIS IRP and GSTZen because CBIC's primary PDFs were unreachable. **Have a CA confirm applicability before go-live** — this document is engineering scoping, not tax advice.
