# ADR-0007: Unit-of-measure model (base unit + sale units)

**Status:** Accepted · 2026-06-24

## Context
Hardware stock is sold in **mixed units**: wire by the metre or the coil, paint by the litre / bucket / can, cement by the kg or the bag, fasteners by the piece or the box. The same physical stock must be sellable in any of these, and bargaining means prices are set per sale unit (a coil is **not** mechanically 90× the per-metre price). Measured goods (length/weight/volume) need **decimal** quantities; piece-type goods stay **whole**. This is flagged as the **highest-risk data model** in the feature proposal (`../documentation/req_v1/02-feature-proposal.md`), so it is decided explicitly and early.

## Decision
Model each product with **one base unit** (the unit stock is physically held and decremented in) plus **one or more sale units**, each carrying a **conversion factor** to the base unit. Key rules:
- **Stock is held and decremented in the base unit only** — one pool, regardless of which sale unit a customer buys in.
- **Price is set per sale unit** (independently, not derived by multiplying the base price) — this also drives quantity-break/bulk pricing.
- **Cost is tracked per base unit** for margin calculation.
- **Quantity type per unit:** measured units allow **decimals**; piece-type units are **whole numbers** (with step sizes where relevant).
- At billing/checkout the operator picks the sale unit; the system converts `qty × factor` to base units to decrement the shared pool.

The conversion/pricing logic lives in `@hardware/core` so POS, storefront, and reports all use one implementation.

## Consequences
**Positive**
- One shared stock pool stays consistent no matter the sale unit — foundational to the no-oversell guarantee (`../09-nfr.md` NFR-REL-01).
- Per-sale-unit pricing matches real hardware-shop economics and feeds bulk/quantity-break pricing cleanly.
- Decimal-vs-whole enforcement prevents nonsensical quantities (e.g., 2.5 pieces).
- Centralizing conversion in `core` makes it unit-testable (NFR-MNT-02) and prevents rounding/derivation bugs across surfaces.

**Negative / tradeoffs**
- Added schema and UI complexity: every product carries a unit table; billing/checkout must surface unit selection.
- **Rounding and conversion edge cases** (factors that don't divide evenly, MRP-inclusive back-calculation, GST rounding) must be handled deliberately — concentrated in `core` and covered by tests.
- Repacking flows (open a box → sell singles) and base-unit changes need careful migration handling (repacking is a nice-to-have; `02-feature-proposal.md`).

## Alternatives considered
- **One unit per product (single UoM)** — far simpler, but cannot represent the core hardware use case; rejected.
- **Derive sale-unit price by multiplying base price × factor** — rejected: forbids independent/bulk pricing and the bargaining reality.
- **Separate SKU per unit (e.g., "wire-metre" and "wire-coil" as distinct products)** — rejected: fragments the shared stock pool and reintroduces overselling risk and reconciliation pain.

See also: `../03-technical-architecture.md` (UoM + stock transaction patterns), `../09-nfr.md` (NFR-REL-01/07, NFR-MNT-02).
