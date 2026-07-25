# Competitor & Market Research

**Status:** DRAFT · 2026-06-24
Purpose: survey what existing hardware/retail apps do, so we copy what works and skip what doesn't.

## Apps surveyed
| App | Focus | Notes |
|-----|-------|-------|
| **Vyapar** | GST billing + inventory (India) | Desktop + mobile, very popular with small shops |
| **myBillBook** | GST billing + inventory (India) | Has explicit "hardware store" mode; auto-detects selling units |
| **Marg ERP 9+ (Hardware & Paint)** | ERP for hardware/paint shops | MRP-wise stock, multi-discount schemes, barcode |
| **GoFrugal RetailEasy** | Retail POS/ERP | Repack bulk→small units, reorder automation, multi-store |
| **Celerant / Ari / Epicor** | Hardware & paint POS (US) | Alternate units of measure, generic items + variants |
| **Sleek Bill / Swipe / Refrens / ClearOne** | GST invoicing | Templates, e-invoice, e-way bill, estimate→invoice |
| **OroCommerce / CloudSuite / BigCommerce B2B** | Building-materials ecommerce | RFQ/quote flow, tiered pricing, credit terms |

## Features that show up everywhere (table stakes)

**Inventory**
- Live stock that auto-updates on every sale/purchase.
- **Multiple units of measure** — stock in one unit, sell in another (e.g., buy a 90 m wire coil, sell per metre; buy a paint bucket, sell per litre; nails by kg *or* piece). Conversion factors are core, not optional, for hardware.
- Decimal / loose quantities (1.5 kg, 2.75 m).
- **MRP-wise stock** — same item with different MRPs/batches, auto rate calculation.
- Barcode generation + scanning; low-stock alerts and reorder levels.
- Bulk → small repacking (open a box of 6, sell singles).
- Damaged-goods / wastage tracking, sales returns.

**Billing / POS**
- GST-compliant tax invoices in seconds; CGST/SGST/IGST auto-split by HSN.
- **Multiple print templates**: A4 / A5 / A6 and thermal 2"/3".
- **Estimate / quotation** that converts to a tax invoice in one click. *(This is the legitimate analogue of "kacha → pakka".)*
- Multiple payment modes: cash, card, UPI, cheque, **credit/khata**.
- Customer ledger / outstanding (receivables) + WhatsApp/SMS payment reminders.
- Item- and bill-level discounts, round-off, sales returns / credit notes.
- e-Invoice (IRN) and e-Way Bill generation — required above GST turnover thresholds.

**Ecommerce (esp. building materials / B2B)**
- Real-time stock + lead times pulled from the same inventory.
- **Tiered / volume pricing** — cheaper per unit as quantity rises.
- **RFQ ("Request for Quote")** flow — order starts as a quote, sales rep can intervene; supports credit limits, payment terms, purchase orders.
- Mobile-first (buyers order from the truck / job site); easy repeat ordering, one-click reorder.
- Technical specs + material calculators (how much paint/wire/cement for X area).

## Takeaways for our build
- **Unit-of-measure handling is the make-or-break feature** for a hardware store — get the data model right first (item → stock unit → sale unit(s) → conversion factor → price per sale unit).
- "Kacha vs pakka" maps cleanly onto the well-established **estimate vs tax-invoice** pattern; the only twist the client wants is *not persisting* kacha history.
- Ecommerce for hardware leans B2B more than typical retail — quotes, bulk pricing, and credit matter as much as a cart/checkout.

## Sources
- [Vyapar — GST billing & inventory](https://vyaparapp.in/)
- [myBillBook — hardware store billing software](https://mybillbook.in/s/billing-software-for-hardware-store/)
- [myBillBook — inventory management](https://mybillbook.in/s/best-inventory-management-software/)
- [Marg ERP 9+ Hardware & Paint](https://www.softwaresuggest.com/marg-hardware-and-paint)
- [GoFrugal — hardware shop software](https://www.gofrugal.com/retail/specialized-retail-pos/hardware-shop-software.html)
- [GoFrugal — electrical shop billing](https://www.gofrugal.com/retail/electronics-pos/electrical-shop-billing-software.html)
- [Celerant — hardware & paint POS](https://www.celerant.com/industries/hardware-paint/)
- [Ari — hardware store POS](https://arirms.com/pos-solutions/hardware-store-pos)
- [Ronix — hardware store inventory software](https://ronixtools.com/en/blog/hardware-store-inventory-software/)
- [Sleek Bill — GST billing](https://sleekbill.in/)
- [myBillBook — e-invoicing](https://mybillbook.in/s/best-e-invoicing-software/)
- [OroCommerce — building materials ecommerce](https://oroinc.com/b2b-ecommerce/blog/ecommerce-for-construction-and-building-materials/)
- [BigCommerce — building & construction materials ecommerce](https://www.bigcommerce.com/blog/b2b-building-and-construction-materials-ecommerce/)
- [CloudSuite — ecommerce for construction materials](https://www.cloudsuite.com/en_US/solutions/ecommerce-for-construction-materials)
- [Rental Invoice — Kaccha vs Pakka bill guide](https://rentalinvoice.in/Blog/Kaccha-Bill-vs-Pakka-Bill-Complete-Guide-for-Indian-Businesses)
