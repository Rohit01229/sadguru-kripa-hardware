import type { InvoiceDTO } from "@hardware/core";
import type { LineLabelLookup } from "../../billing/print/Templates";

// Sample bill for the theme preview (19 §7). Real hardware-shop lines with a real
// CGST/SGST split, a discount and a round-off, so the preview exercises every block a
// live invoice would — including the ones a theme can hide. Fixed values (no Date.now,
// no random) so the preview is stable between renders.
//
// Display-only: this never touches the database and carries no invoice number from the
// gapless series — the number below is illustrative.

const LINES = [
  { name: "UltraTech PPC Cement — Bag", hsn: "2523", qty: "10", rate: 42000, taxable: 420000, gstPct: "18" },
  { name: "Tata TMT Bar 12mm — Piece", hsn: "7213", qty: "25", rate: 6250, taxable: 156250, gstPct: "18" },
  { name: "Finolex Wire 1.5sqmm — Coil", hsn: "8544", qty: "2", rate: 125000, taxable: 250000, gstPct: "18" },
];

const half = (taxable: number, pct: string) => Math.round((taxable * Number(pct)) / 200);

export const SAMPLE_INVOICE: InvoiceDTO = {
  id: "sample",
  fy: "2026-27",
  invoiceNo: "2026-27/000123",
  invoiceType: "PAKKA",
  taxKind: "CGST_SGST",
  placeOfSupplyState: "19",
  customerId: "sample-customer",
  customerName: "Ramesh Traders",
  customerGstin: "19ABCDE1234F1Z5",
  date: "2026-08-03T10:30:00.000Z",
  lines: LINES.map((l, i) => ({
    productId: `sample-p${i}`,
    saleUnitId: `sample-su${i}`,
    hsnCode: l.hsn,
    saleQty: l.qty,
    baseQty: l.qty,
    unitPrice: l.rate,
    lineDiscount: 0,
    taxableValue: l.taxable,
    gstRatePct: l.gstPct,
    cgst: half(l.taxable, l.gstPct),
    sgst: half(l.taxable, l.gstPct),
    igst: 0,
    lineTotal: l.taxable + half(l.taxable, l.gstPct) * 2,
  })),
  taxableTotal: 826250,
  discountTotal: 5000,
  cgstTotal: LINES.reduce((n, l) => n + half(l.taxable, l.gstPct), 0),
  sgstTotal: LINES.reduce((n, l) => n + half(l.taxable, l.gstPct), 0),
  igstTotal: 0,
  roundOff: -25,
  grandTotal: 975150,
  payments: [],
  amountPaid: 975150,
  balanceToLedger: 0,
  changeDue: 0,
  status: "ACTIVE",
  createdAt: "2026-08-03T10:30:00.000Z",
};

export const SAMPLE_LINE_LABELS: LineLabelLookup[] = LINES.map((l, i) => ({
  productId: `sample-p${i}`,
  saleUnitId: `sample-su${i}`,
  label: l.name,
}));
