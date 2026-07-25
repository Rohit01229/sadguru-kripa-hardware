import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  buildGstr1,
  buildDayEnd,
  gstr1ToCsv,
  type ReportInvoice,
  type ReportCreditNote,
} from "./aggregate";

// S7 report-aggregation unit tests (04 Reports; 03 §8; 13 reports note). PURE,
// DB-free — the load-bearing GSTR-1 / day-end math the S7 gate grades: B2B vs B2C
// split by GSTIN, HSN summary netting credit notes, kacha-exclusion (no kacha rows
// can reach these), cancelled-invoice exclusion, and the day-end pakka roll-up.

const D = (v: string | number) => new Decimal(v);

function inv(over: Partial<ReportInvoice> = {}): ReportInvoice {
  return {
    id: over.id ?? "inv_1",
    invoiceNo: over.invoiceNo ?? "2026-27/000001",
    date: over.date ?? new Date("2026-06-10T08:00:00Z"),
    status: over.status ?? "ACTIVE",
    placeOfSupplyState: over.placeOfSupplyState ?? "19",
    customerGstin: over.customerGstin ?? null,
    customerName: over.customerName ?? "Walk-in",
    taxableTotal: over.taxableTotal ?? D(1000),
    cgstTotal: over.cgstTotal ?? D(90),
    sgstTotal: over.sgstTotal ?? D(90),
    igstTotal: over.igstTotal ?? D(0),
    roundOff: over.roundOff ?? D(0),
    grandTotal: over.grandTotal ?? D(1180),
    paymentModes: over.paymentModes ?? ["CASH"],
    lines: over.lines ?? [
      { hsnCode: "8544", baseQty: D(10), saleQty: D(10), taxableValue: D(1000), gstRate: D(18), cgst: D(90), sgst: D(90), igst: D(0), baseUnitCode: "MTR" },
    ],
  };
}

describe("reports.buildGstr1 — B2B / B2C split + totals", () => {
  it("routes a GSTIN customer to B2B and a walk-in to B2C", () => {
    const agg = buildGstr1(
      "2026-06",
      [
        inv({ id: "a", invoiceNo: "INV-A", customerGstin: "19ABCDE1234F1Z5", customerName: "Sharma HW" }),
        inv({ id: "b", invoiceNo: "INV-B", customerGstin: null }),
      ],
      [],
    );
    expect(agg.b2b).toHaveLength(1);
    expect(agg.b2b[0]!.invoiceNo).toBe("INV-A");
    expect(agg.b2c).toHaveLength(1);
    expect(agg.b2c[0]!.invoiceNo).toBe("INV-B");
    expect(agg.totals.b2bTaxable.toString()).toBe("1000");
    expect(agg.totals.b2cTaxable.toString()).toBe("1000");
    expect(agg.totals.cgst.toString()).toBe("180");
    expect(agg.totals.sgst.toString()).toBe("180");
  });

  it("EXCLUDES cancelled invoices from every section + total", () => {
    const agg = buildGstr1(
      "2026-06",
      [inv({ id: "live" }), inv({ id: "dead", status: "CANCELLED", invoiceNo: "INV-DEAD" })],
      [],
    );
    expect(agg.b2c).toHaveLength(1);
    expect(agg.totals.b2cTaxable.toString()).toBe("1000");
  });

  it("inter-state invoice carries IGST, no CGST/SGST", () => {
    const agg = buildGstr1(
      "2026-06",
      [
        inv({
          placeOfSupplyState: "27",
          cgstTotal: D(0),
          sgstTotal: D(0),
          igstTotal: D(180),
          lines: [{ hsnCode: "8544", baseQty: D(10), saleQty: D(10), taxableValue: D(1000), gstRate: D(18), cgst: D(0), sgst: D(0), igst: D(180), baseUnitCode: "MTR" }],
        }),
      ],
      [],
    );
    expect(agg.totals.igst.toString()).toBe("180");
    expect(agg.totals.cgst.toString()).toBe("0");
    expect(agg.hsn[0]!.igst.toString()).toBe("180");
  });
});

describe("reports.buildGstr1 — HSN summary nets credit notes", () => {
  it("aggregates lines by HSN+UQC and SUBTRACTS credit-note qty/value", () => {
    const cn: ReportCreditNote = {
      id: "cn_1",
      creditNoteNo: "CN-1",
      createdAt: new Date("2026-06-15T00:00:00Z"),
      invoiceNo: "INV-A",
      invoiceDate: new Date("2026-06-10T00:00:00Z"),
      customerGstin: "19ABCDE1234F1Z5",
      placeOfSupplyState: "19",
      taxableTotal: D(200),
      cgstTotal: D(18),
      sgstTotal: D(18),
      igstTotal: D(0),
      grandTotal: D(236),
      lines: [{ hsnCode: "8544", baseQty: D(2), taxableValue: D(200), gstRate: D(18), cgst: D(18), sgst: D(18), igst: D(0), baseUnitCode: "MTR" }],
    };
    const agg = buildGstr1("2026-06", [inv({ customerGstin: "19ABCDE1234F1Z5" })], [cn]);
    // 10 sold − 2 returned = 8 net qty; 1000 − 200 = 800 net taxable.
    const hsn = agg.hsn.find((h) => h.hsnCode === "8544")!;
    expect(hsn.totalQty.toString()).toBe("8");
    expect(hsn.taxableValue.toString()).toBe("800");
    // CGST nets 90 − 18 = 72.
    expect(agg.totals.cgst.toString()).toBe("72");
    expect(agg.creditNotes).toHaveLength(1);
    expect(agg.totals.cnTaxable.toString()).toBe("200");
  });

  it("groups two lines of the SAME hsn into one summary row", () => {
    const agg = buildGstr1(
      "2026-06",
      [
        inv({
          lines: [
            { hsnCode: "8544", baseQty: D(5), saleQty: D(5), taxableValue: D(500), gstRate: D(18), cgst: D(45), sgst: D(45), igst: D(0), baseUnitCode: "MTR" },
            { hsnCode: "8544", baseQty: D(5), saleQty: D(5), taxableValue: D(500), gstRate: D(18), cgst: D(45), sgst: D(45), igst: D(0), baseUnitCode: "MTR" },
          ],
        }),
      ],
      [],
    );
    expect(agg.hsn).toHaveLength(1);
    expect(agg.hsn[0]!.totalQty.toString()).toBe("10");
    expect(agg.hsn[0]!.taxableValue.toString()).toBe("1000");
  });

  it("falls back to UNCLASSIFIED for a null HSN", () => {
    const agg = buildGstr1(
      "2026-06",
      [inv({ lines: [{ hsnCode: null, baseQty: D(1), saleQty: D(1), taxableValue: D(100), gstRate: D(18), cgst: D(9), sgst: D(9), igst: D(0), baseUnitCode: "PCS" }] })],
      [],
    );
    expect(agg.hsn[0]!.hsnCode).toBe("UNCLASSIFIED");
  });
});

describe("reports.buildDayEnd — pakka roll-up (kacha excluded; cancelled counted not summed)", () => {
  it("sums active invoices and counts (but does not sum) cancelled ones", () => {
    const summary = buildDayEnd(
      "2026-06-10",
      [
        inv({ id: "a", grandTotal: D(1180), taxableTotal: D(1000), cgstTotal: D(90), sgstTotal: D(90) }),
        inv({ id: "b", grandTotal: D(590), taxableTotal: D(500), cgstTotal: D(45), sgstTotal: D(45) }),
        inv({ id: "c", status: "CANCELLED", grandTotal: D(9999) }),
      ],
      [
        { mode: "CASH", amount: D(1180) },
        { mode: "UPI", amount: D(590) },
      ],
      [{ grandTotal: D(100) }],
    );
    expect(summary.invoiceCount).toBe(2);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.taxableTotal.toString()).toBe("1500");
    expect(summary.grandTotal.toString()).toBe("1770"); // cancelled 9999 NOT included
    expect(summary.cgstTotal.toString()).toBe("135");
    expect(summary.byPaymentMode.find((m) => m.mode === "CASH")!.amount.toString()).toBe("1180");
    expect(summary.creditNoteCount).toBe(1);
    expect(summary.creditNoteTotal.toString()).toBe("100");
  });

  it("an empty day produces a zeroed summary (never fabricated)", () => {
    const summary = buildDayEnd("2026-06-11", [], [], []);
    expect(summary.invoiceCount).toBe(0);
    expect(summary.grandTotal.toString()).toBe("0");
    expect(summary.byPaymentMode).toHaveLength(0);
  });
});

describe("reports.gstr1ToCsv — four sections, rupee 2dp", () => {
  it("emits B2B / B2C / Credit Notes / HSN section headers", () => {
    const agg = buildGstr1("2026-06", [inv({ customerGstin: "19ABCDE1234F1Z5" })], []);
    const csv = gstr1ToCsv(agg);
    expect(csv).toContain("## B2B (registered customers)");
    expect(csv).toContain("## B2C (unregistered customers)");
    expect(csv).toContain("## Credit Notes");
    expect(csv).toContain("## HSN Summary");
    // taxable rendered as rupees with 2dp.
    expect(csv).toContain("1000.00");
    expect(csv).toContain("8544");
  });

  it("quotes a field containing a comma", () => {
    const agg = buildGstr1(
      "2026-06",
      [inv({ customerGstin: "19ABCDE1234F1Z5", customerName: "Sharma, Hardware & Co" })],
      [],
    );
    const csv = gstr1ToCsv(agg);
    expect(csv).toContain('"Sharma, Hardware & Co"');
  });
});
