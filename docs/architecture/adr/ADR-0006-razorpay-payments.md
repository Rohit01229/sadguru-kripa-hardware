# ADR-0006: Razorpay for payments (hosted checkout + webhooks)

**Status:** Accepted · 2026-06-24

## Context
The storefront supports **online payment (UPI/cards)** alongside pay-at-store / pay-on-delivery (`../documentation/req_v1/02-feature-proposal.md` Decision 10). The shop is in India, so UPI is the dominant rail. We must minimize PCI scope (no card data should touch our servers — `../09-nfr.md` NFR-SEC-06) and ensure payment handling is **idempotent** so a webhook retry never double-credits or double-books an order (NFR-REL-04). We also want INR billing and no fixed AMC/setup cost.

## Decision
Use **Razorpay** as the payment gateway, via its **hosted checkout** (UPI + cards; the customer enters payment details on Razorpay, not on our pages). Order/payment status is reconciled through **signature-verified webhooks**, processed **idempotently** (idempotency key per order; replays are no-ops). We store only order/payment references — never PANs.

## Consequences
**Positive**
- Hosted checkout keeps **card data off our servers**, drastically shrinking PCI scope (NFR-SEC-06).
- First-class **UPI** support — the right rail for Indian retail; cards covered too.
- INR billing, **~2% + GST per successful transaction**, no setup/AMC (`../09-nfr.md` NFR-COST-06).
- Webhooks decouple payment confirmation from the user's browser session, improving reliability of order state.
- Signature verification + idempotency directly satisfy the payment-integrity NFR (NFR-REL-04, NFR-SEC-07).

**Negative / tradeoffs**
- Per-transaction fee (~2% + GST) is an ongoing cost on online sales — accepted; offset by avoiding gateway setup/AMC.
- Vendor dependency on Razorpay availability; mitigated because **core billing (cash/UPI-manual/credit) does not hard-depend on the gateway** (NFR-AVL-06) — a gateway outage doesn't stop counter billing.
- Webhook handling must be implemented carefully (verify signature, dedupe, handle out-of-order/late events) or it becomes a correctness bug.

## Alternatives considered
- **Stripe** — strong product, but weaker India/UPI fit and INR/regulatory friction for a small Indian shop; rejected.
- **PayU / Cashfree / Instamojo** — viable Indian gateways; Razorpay chosen as the de-facto standard with strong UPI + hosted checkout and broad documentation. Not deeply load-bearing — could be revisited on pricing.
- **Self-hosted card handling** — rejected outright: would pull full PCI-DSS scope onto our servers.

See also: `../07-security-architecture.md`, `../09-nfr.md` (NFR-REL-04, NFR-SEC-06/07, NFR-AVL-06).
