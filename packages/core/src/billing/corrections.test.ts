import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import type * as DecimalModule from "decimal.js";

// S5 billing-correction unit tests (04 Billing cancel/credit-note; 13 §8). Asserts:
//  - cancelInvoice reverses stock (SALES_RETURN_IN per line) + the khata ledger and
//    sets status CANCELLED without deleting (gapless preserved); owner-only.
//  - createCreditNote allocates an INDEPENDENT gapless CN number, reverses stock,
//    rejects returns exceeding billed qty, and settles each refund mode correctly
//    (KHATA_ADJUST credits the ledger; CASH does not).
// Decimal.js is real; only the db layer is mocked so the real control flow runs.

// Hoisted mutable state so the vi.mock factory (hoisted to file top) can read it.
const h = vi.hoisted(() => ({
  tableCalls: {} as Record<string, string[]>,
  invoiceFixture: null as Record<string, unknown> | null,
  cnCounterSeq: 0,
}));

function record(table: string, op: string) {
  (h.tableCalls[table] ??= []).push(op);
}

function D(v: string | number) {
  return new Decimal(v);
}

function makeTx() {
  return {
    invoice: {
      findUnique: vi.fn(async () => h.invoiceFixture),
      update: vi.fn(async () => {
        record("invoice.update", "update");
        return { id: "inv_1" };
      }),
    },
    productSaleUnit: {
      findFirst: vi.fn(async () => ({
        id: "su_1",
        factorToBase: { toString: () => "1" },
        salePrice: { toString: () => "0" },
        unit: { code: "pc", kind: "PIECE" },
        product: { id: "prod_1", gstRate: { toString: () => "18" }, priceInclusive: false, hsnCode: "7217" },
      })),
    },
    productStock: { upsert: vi.fn(async () => ({})) },
    stockMovement: {
      create: vi.fn(async () => {
        record("stockMovement", "create");
        return { id: "mv_1" };
      }),
    },
    ledgerEntry: {
      create: vi.fn(async (args: { data: { type: string; amount: unknown } }) => {
        record("ledgerEntry", `create:${args.data.type}`);
        return { id: "le_1" };
      }),
      aggregate: vi.fn(async () => ({ _sum: { amount: D("0") } })),
    },
    creditNote: {
      create: vi.fn(async () => {
        record("creditNote", "create");
        return { id: "cn_1", createdAt: new Date("2026-06-28T00:00:00Z") };
      }),
    },
    creditNoteCounter: { upsert: vi.fn(async () => ({})) },
    invoiceCounter: { upsert: vi.fn(async () => ({})) },
    auditLog: {
      create: vi.fn(async () => {
        record("auditLog", "create");
        return { id: "audit_1" };
      }),
    },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("CreditNoteCounter")) {
        h.cnCounterSeq += 1;
        return [{ lastNo: h.cnCounterSeq }];
      }
      return [{ lastNo: 1 }];
    }),
  };
}

let tx = makeTx();

// A complete, already-cancelled invoice (with empty payments) for the getInvoice
// re-read cancelInvoice does through the top-level prisma client.
function cancelledReadback() {
  return {
    id: "inv_1",
    fy: "2026-27",
    invoiceNo: "2026-27/000142",
    customerId: "cust_1",
    customerNameSnap: "Sharma",
    customerGstinSnap: null,
    placeOfSupplyState: "19",
    date: new Date("2026-06-28T00:00:00Z"),
    taxableTotal: D("1000"),
    discountTotal: D("0"),
    cgstTotal: D("90"),
    sgstTotal: D("90"),
    igstTotal: D("0"),
    roundOff: D("0"),
    grandTotal: D("1180"),
    status: "CANCELLED",
    createdAt: new Date("2026-06-28T00:00:00Z"),
    lines: [
      {
        productId: "prod_1",
        saleUnitId: "su_1",
        hsnCode: "7217",
        saleQty: D("10"),
        baseQty: D("10"),
        unitPrice: D("100"),
        lineDiscount: D("0"),
        taxableValue: D("1000"),
        gstRate: D("18"),
        cgst: D("90"),
        sgst: D("90"),
        igst: D("0"),
      },
    ],
    payments: [],
  };
}

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  return {
    prisma: {
      invoice: { findUnique: vi.fn(async () => cancelledReadback()) },
      creditNote: { findMany: vi.fn(async () => []) },
    },
    Prisma: { Decimal: actual.default, PrismaClientKnownRequestError: class {} },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

import { cancelInvoice, createCreditNote } from "./service";

const ownerCtx = {
  session: {
    userId: "owner_1",
    realm: "STAFF" as const,
    roles: ["OWNER"],
    permissions: ["bill.cancel", "bill.creditnote.create"],
  },
  requestId: "req_1",
};

// A cashier session WITHOUT bill.cancel (owner-only) but WITH creditnote.
const cashierCtx = {
  session: {
    userId: "cashier_1",
    realm: "STAFF" as const,
    roles: ["CASHIER"],
    permissions: ["bill.pakka.create", "bill.creditnote.create"],
  },
  requestId: "req_2",
};

function activeInvoice(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inv_1",
    fy: "2026-27",
    invoiceNo: "2026-27/000142",
    status: "ACTIVE",
    customerId: "cust_1",
    igstTotal: D("0"),
    lines: [
      {
        productId: "prod_1",
        saleUnitId: "su_1",
        baseQty: D("10"),
        taxableValue: D("1000"),
        gstRate: D("18"),
        cgst: D("90"),
        sgst: D("90"),
        igst: D("0"),
      },
    ],
    creditNotes: [],
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(h.tableCalls)) delete h.tableCalls[k];
  tx = makeTx();
  h.cnCounterSeq = 0;
  h.invoiceFixture = null;
});

describe("billing.cancelInvoice — reverse stock + ledger, never delete (owner-only)", () => {
  it("denies a non-owner (no bill.cancel)", async () => {
    h.invoiceFixture = activeInvoice();
    await expect(cancelInvoice("inv_1", { reason: "wrong customer" }, cashierCtx)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reverses stock IN per line, credits the khata ledger, and sets CANCELLED (no delete)", async () => {
    h.invoiceFixture = activeInvoice();
    tx.ledgerEntry.aggregate = vi.fn(async () => ({ _sum: { amount: D("1180") } }));

    await cancelInvoice("inv_1", { reason: "billing error" }, ownerCtx);

    expect(h.tableCalls.stockMovement).toEqual(["create"]);
    expect(h.tableCalls.ledgerEntry).toEqual(["create:CREDIT_NOTE_CREDIT"]);
    expect(h.tableCalls["invoice.update"]).toEqual(["update"]);
    expect(h.tableCalls.auditLog).toEqual(["create"]);
  });

  it("does not touch the ledger when the invoice posted no receivable (cash sale)", async () => {
    h.invoiceFixture = activeInvoice({ customerId: null });
    await cancelInvoice("inv_1", { reason: "cash sale void" }, ownerCtx);
    expect(h.tableCalls.ledgerEntry).toBeUndefined();
    expect(h.tableCalls.stockMovement).toEqual(["create"]);
  });

  it("rejects cancelling an already-cancelled invoice (422 ALREADY_CANCELLED)", async () => {
    h.invoiceFixture = activeInvoice({ status: "CANCELLED" });
    await expect(cancelInvoice("inv_1", { reason: "again" }, ownerCtx)).rejects.toMatchObject({
      code: "ALREADY_CANCELLED",
    });
  });

  it("requires a non-empty reason (Zod)", async () => {
    h.invoiceFixture = activeInvoice();
    await expect(cancelInvoice("inv_1", { reason: "" }, ownerCtx)).rejects.toThrow();
  });
});

describe("billing.createCreditNote — independent gapless series + refund modes", () => {
  it("allocates its own gapless CN number and reverses stock", async () => {
    h.invoiceFixture = activeInvoice();
    const cn = await createCreditNote(
      "inv_1",
      { lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "10" }], refundMode: "CASH" },
      ownerCtx,
    );
    expect(cn.creditNoteNo).toBe("2026-27/000001");
    expect(h.tableCalls.creditNote).toEqual(["create"]);
    expect(h.tableCalls.stockMovement).toEqual(["create"]);
    expect(h.tableCalls.ledgerEntry).toBeUndefined();
  });

  it("credits the customer ledger when refundMode is KHATA_ADJUST", async () => {
    h.invoiceFixture = activeInvoice();
    await createCreditNote(
      "inv_1",
      { lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "10" }], refundMode: "KHATA_ADJUST" },
      ownerCtx,
    );
    expect(h.tableCalls.ledgerEntry).toEqual(["create:CREDIT_NOTE_CREDIT"]);
  });

  it("prices a PARTIAL return pro-rata of the original line", async () => {
    h.invoiceFixture = activeInvoice();
    const cn = await createCreditNote(
      "inv_1",
      { lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "5" }], refundMode: "CASH" },
      ownerCtx,
    );
    expect(cn.taxableTotal).toBe(50000);
    expect(cn.cgstTotal).toBe(4500);
    expect(cn.sgstTotal).toBe(4500);
    expect(cn.grandTotal).toBe(59000);
  });

  it("rejects a return exceeding the billed quantity (400 RETURN_EXCEEDS_BILLED)", async () => {
    h.invoiceFixture = activeInvoice();
    await expect(
      createCreditNote(
        "inv_1",
        { lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "11" }], refundMode: "CASH" },
        ownerCtx,
      ),
    ).rejects.toMatchObject({ code: "RETURN_EXCEEDS_BILLED" });
  });

  it("rejects a credit note against a cancelled invoice (422 INVOICE_CANCELLED)", async () => {
    h.invoiceFixture = activeInvoice({ status: "CANCELLED" });
    await expect(
      createCreditNote(
        "inv_1",
        { lines: [{ productId: "prod_1", saleUnitId: "su_1", quantity: "1" }], refundMode: "CASH" },
        ownerCtx,
      ),
    ).rejects.toMatchObject({ code: "INVOICE_CANCELLED" });
  });
});
