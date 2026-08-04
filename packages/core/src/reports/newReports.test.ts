import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// Unit tests for the reports added in 19 §11 — purchases, receivables, collections and
// sales returns. Decimal.js is real (the money maths must be exercised for real); only
// the db layer is mocked, matching ledger/filters.test.ts.

interface GrnLineRow {
  productId: string;
  baseQty: unknown;
  costPerBaseUnit: unknown;
}
interface GrnRow {
  id: string;
  date: Date;
  supplier: { id: string; name: string } | null;
  lines: GrnLineRow[];
}
interface PaymentRow {
  amount: unknown;
  mode: string;
  date: Date;
}
interface CreditNoteRow {
  id: string;
  creditNoteNo: string;
  createdAt: Date;
  reason: string | null;
  refundMode: string | null;
  taxableTotal: unknown;
  cgstTotal: unknown;
  sgstTotal: unknown;
  igstTotal: unknown;
  grandTotal: unknown;
  invoice: { invoiceNo: string; customerNameSnap: string | null };
}

let grns: GrnRow[] = [];
let payments: PaymentRow[] = [];
let creditNotes: CreditNoteRow[] = [];
let customers: { id: string; name: string; phone: string | null }[] = [];
let products: { id: string; name: string; sku: string; baseUnit: { code: string } }[] = [];
/** customerId → aging result the mocked ledger returns. */
let agingByCustomer: Record<
  string,
  { outstanding: number; bucket0to30: number; bucket31to60: number; bucket60plus: number }
> = {};

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = actual.default;
  return {
    prisma: {
      goodsReceipt: { findMany: vi.fn(async () => grns) },
      payment: { findMany: vi.fn(async () => payments) },
      creditNote: { findMany: vi.fn(async () => creditNotes) },
      customer: { findMany: vi.fn(async () => customers) },
      product: { findMany: vi.fn(async () => products) },
    },
    Prisma: { Decimal: PrismaDecimal },
  };
});

// The aging maths is already proven in ledger tests; stub it so these tests exercise
// the ASSEMBLY (filtering, ordering, totals) rather than re-testing buckets.
vi.mock("../ledger/service", () => ({
  aging: vi.fn(async (_shopId: string, customerId: string) => ({
    customerId,
    outstanding: agingByCustomer[customerId]?.outstanding ?? 0,
    bucket0to30: agingByCustomer[customerId]?.bucket0to30 ?? 0,
    bucket31to60: agingByCustomer[customerId]?.bucket31to60 ?? 0,
    bucket60plus: agingByCustomer[customerId]?.bucket60plus ?? 0,
  })),
}));

const { purchaseReport, receivables, collections, salesReturns } = await import("./service");

const D = (v: string | number) => v as unknown;

beforeEach(() => {
  grns = [];
  payments = [];
  creditNotes = [];
  customers = [];
  products = [];
  agingByCustomer = {};
});

describe("purchaseReport", () => {
  beforeEach(() => {
    products = [
      { id: "p1", name: "Cement", sku: "CEM-1", baseUnit: { code: "BAG" } },
      { id: "p2", name: "TMT Bar", sku: "TMT-1", baseUnit: { code: "PCS" } },
    ];
    grns = [
      {
        id: "g1",
        date: new Date("2026-08-01T06:00:00Z"),
        supplier: { id: "s1", name: "Acme Traders" },
        lines: [
          { productId: "p1", baseQty: D("10"), costPerBaseUnit: D("400") },
          { productId: "p2", baseQty: D("20"), costPerBaseUnit: D("55") },
        ],
      },
      {
        id: "g2",
        date: new Date("2026-08-02T06:00:00Z"),
        supplier: { id: "s2", name: "Bharat Steel" },
        lines: [{ productId: "p2", baseQty: D("100"), costPerBaseUnit: D("50") }],
      },
    ];
  });

  it("totals purchase value as qty × cost, in paise", () => {
    return purchaseReport("shop_1", { from: "2026-08-01", to: "2026-08-02" }).then((r) => {
      // 10×400 + 20×55 + 100×50 = 4000 + 1100 + 5000 = ₹10,100
      expect(r.totalValue).toBe(1010000);
      expect(r.grnCount).toBe(2);
    });
  });

  it("groups by day in chronological order", async () => {
    const r = await purchaseReport("shop_1", { from: "2026-08-01", to: "2026-08-02", groupBy: "day" });
    expect(r.rows.map((x) => x.key)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(r.rows[0]!.value).toBe(510000); // 4000 + 1100
    expect(r.rows[1]!.value).toBe(500000);
  });

  it("groups by supplier, biggest spend first", async () => {
    const r = await purchaseReport("shop_1", { groupBy: "supplier" });
    expect(r.rows[0]!.label).toBe("Acme Traders"); // 5100 > 5000
    expect(r.rows[1]!.label).toBe("Bharat Steel");
  });

  it("groups by item and sums quantity with its base unit", async () => {
    const r = await purchaseReport("shop_1", { groupBy: "item" });
    const tmt = r.rows.find((x) => x.key === "p2")!;
    expect(tmt.label).toBe("TMT Bar (TMT-1)");
    expect(tmt.qty).toBe("120 PCS"); // 20 + 100 across two receipts
    expect(tmt.value).toBe(610000); // 1100 + 5000
  });

  it("labels receipts with no supplier rather than dropping them", async () => {
    grns = [{ id: "g3", date: new Date("2026-08-01T06:00:00Z"), supplier: null, lines: [{ productId: "p1", baseQty: D("1"), costPerBaseUnit: D("100") }] }];
    const r = await purchaseReport("shop_1", { groupBy: "supplier" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.label).toBe("No supplier recorded");
  });

  it("returns an empty report rather than throwing when nothing was bought", async () => {
    grns = []; // the mocked db ignores the date filter, so clear the fixture explicitly
    const r = await purchaseReport("shop_1", {});
    expect(r.rows).toEqual([]);
    expect(r.totalValue).toBe(0);
    expect(r.grnCount).toBe(0);
  });
});

describe("receivables", () => {
  beforeEach(() => {
    customers = [
      { id: "c1", name: "Ramesh", phone: "9876543210" },
      { id: "c2", name: "Suresh", phone: null },
      { id: "c3", name: "Paid Up", phone: null },
    ];
    agingByCustomer = {
      c1: { outstanding: 50000, bucket0to30: 20000, bucket31to60: 10000, bucket60plus: 20000 },
      c2: { outstanding: 120000, bucket0to30: 120000, bucket31to60: 0, bucket60plus: 0 },
      c3: { outstanding: 0, bucket0to30: 0, bucket31to60: 0, bucket60plus: 0 },
    };
  });

  it("hides settled parties by default — a dues list should show dues", async () => {
    const r = await receivables("shop_1", {});
    expect(r.rows.map((x) => x.customerId)).toEqual(["c2", "c1"]);
    expect(r.partyCount).toBe(3);
  });

  it("orders biggest debtor first (it is a call sheet)", async () => {
    const r = await receivables("shop_1", {});
    expect(r.rows[0]!.name).toBe("Suresh");
    expect(r.rows[0]!.outstanding).toBe(120000);
  });

  it("includes settled parties when asked", async () => {
    const r = await receivables("shop_1", { dueOnly: false });
    expect(r.rows).toHaveLength(3);
  });

  it("totals each aging bucket across parties", async () => {
    const r = await receivables("shop_1", {});
    expect(r.totalOutstanding).toBe(170000);
    expect(r.total0to30).toBe(140000);
    expect(r.total31to60).toBe(10000);
    expect(r.total60plus).toBe(20000);
  });

  it("totals over ALL due parties even when the row list is capped", async () => {
    const r = await receivables("shop_1", { limit: 1 });
    expect(r.rows).toHaveLength(1);
    // The headline figure must not silently shrink to the visible page.
    expect(r.totalOutstanding).toBe(170000);
  });
});

describe("collections", () => {
  beforeEach(() => {
    payments = [
      { amount: D("500"), mode: "CASH", date: new Date("2026-08-01T05:00:00Z") },
      { amount: D("250.50"), mode: "UPI", date: new Date("2026-08-01T09:00:00Z") },
      { amount: D("1000"), mode: "CASH", date: new Date("2026-08-02T05:00:00Z") },
    ];
  });

  it("sums collections in paise", async () => {
    const r = await collections("shop_1", { from: "2026-08-01", to: "2026-08-02" });
    expect(r.total).toBe(175050);
    expect(r.count).toBe(3);
  });

  it("groups by day, chronologically", async () => {
    const r = await collections("shop_1", { groupBy: "day" });
    expect(r.rows.map((x) => x.key)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(r.rows[0]!.amount).toBe(75050);
  });

  it("groups by payment mode, largest first", async () => {
    const r = await collections("shop_1", { groupBy: "mode" });
    expect(r.rows[0]!.key).toBe("CASH");
    expect(r.rows[0]!.amount).toBe(150000);
    expect(r.rows[0]!.count).toBe(2);
    expect(r.rows[1]!.key).toBe("UPI");
  });
});

describe("salesReturns", () => {
  beforeEach(() => {
    creditNotes = [
      {
        id: "cn1",
        creditNoteNo: "2026-27/CN0001",
        createdAt: new Date("2026-08-02T06:00:00Z"),
        reason: "Damaged in transit",
        refundMode: "CASH",
        taxableTotal: D("1000"),
        cgstTotal: D("90"),
        sgstTotal: D("90"),
        igstTotal: D("0"),
        grandTotal: D("1180"),
        invoice: { invoiceNo: "2026-27/000010", customerNameSnap: "Ramesh" },
      },
      {
        id: "cn2",
        creditNoteNo: "2026-27/CN0002",
        createdAt: new Date("2026-08-01T06:00:00Z"),
        reason: null,
        refundMode: "KHATA_ADJUST",
        taxableTotal: D("500"),
        cgstTotal: D("0"),
        sgstTotal: D("0"),
        igstTotal: D("90"),
        grandTotal: D("590"),
        invoice: { invoiceNo: "2026-27/000011", customerNameSnap: null },
      },
    ];
  });

  it("lists every credit note with its bill and reason", async () => {
    const r = await salesReturns("shop_1", { from: "2026-08-01", to: "2026-08-02" });
    expect(r.count).toBe(2);
    expect(r.rows[0]!.invoiceNo).toBe("2026-27/000010");
    expect(r.rows[0]!.reason).toBe("Damaged in transit");
    expect(r.rows[1]!.customerName).toBeNull();
  });

  it("sums tax across BOTH the CGST/SGST and IGST shapes", async () => {
    const r = await salesReturns("shop_1", {});
    // (90+90) + 90 = 270
    expect(r.totalTax).toBe(27000);
    expect(r.totalTaxable).toBe(150000);
    expect(r.totalGrand).toBe(177000);
  });
});
