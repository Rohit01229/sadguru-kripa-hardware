import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// S5 ledger AGING + post-sign unit tests (04 Ledger; 13 §7). The aging FIFO logic
// and the post() sign normalisation are the load-bearing money math the S5 gate
// grades. Decimal.js is real; only the db layer is mocked. We feed ledger rows of a
// chosen age and assert the 0-30 / 31-60 / 60+ buckets, and that payments/credit
// notes settle the OLDEST debits first.

const DAY = 24 * 60 * 60 * 1000;
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

// Rows the mocked prisma.ledgerEntry.findMany returns (Decimal amounts).
let ledgerRows: { type: string; amount: unknown; createdAt: Date }[] = [];

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = actual.default;
  return {
    prisma: {
      ledgerEntry: {
        findMany: vi.fn(async () => ledgerRows),
        aggregate: vi.fn(async () => {
          const sum = ledgerRows.reduce(
            (a, r) => a.plus(new PrismaDecimal(r.amount as never)),
            new PrismaDecimal(0),
          );
          return { _sum: { amount: sum } };
        }),
      },
    },
    Prisma: { Decimal: PrismaDecimal },
    runTx: async (fn: (t: unknown) => Promise<unknown>) => fn({}),
  };
});

import { aging, outstanding } from "./service";
import { Prisma } from "../shared/db";

const D = (v: string) => new Prisma.Decimal(v);

describe("ledger.aging — 0-30 / 31-60 / 60+ FIFO buckets", () => {
  beforeEach(() => {
    ledgerRows = [];
  });

  it("buckets each unpaid debit by its age", async () => {
    ledgerRows = [
      { type: "INVOICE_DEBIT", amount: D("100"), createdAt: daysAgo(5) }, // 0-30
      { type: "INVOICE_DEBIT", amount: D("200"), createdAt: daysAgo(45) }, // 31-60
      { type: "INVOICE_DEBIT", amount: D("300"), createdAt: daysAgo(90) }, // 60+
    ];
    const a = await aging("cust_1");
    expect(a.bucket0to30).toBe(10000);
    expect(a.bucket31to60).toBe(20000);
    expect(a.bucket60plus).toBe(30000);
    expect(a.outstanding).toBe(60000);
  });

  it("settles the OLDEST debit first (FIFO) when a payment lands", async () => {
    // 300 owed on a 90-day-old bill, 100 on a 5-day-old bill; a 300 payment clears
    // the old bill entirely → only the recent 100 remains in 0-30.
    ledgerRows = [
      { type: "INVOICE_DEBIT", amount: D("300"), createdAt: daysAgo(90) },
      { type: "INVOICE_DEBIT", amount: D("100"), createdAt: daysAgo(5) },
      { type: "PAYMENT_CREDIT", amount: D("-300"), createdAt: daysAgo(1) },
    ];
    const a = await aging("cust_1");
    expect(a.bucket60plus).toBe(0);
    expect(a.bucket0to30).toBe(10000);
    expect(a.outstanding).toBe(10000);
  });

  it("partially settles the oldest bill, leaving the remainder in its age bucket", async () => {
    ledgerRows = [
      { type: "INVOICE_DEBIT", amount: D("500"), createdAt: daysAgo(70) }, // 60+
      { type: "PAYMENT_CREDIT", amount: D("-200"), createdAt: daysAgo(1) },
    ];
    const a = await aging("cust_1");
    expect(a.bucket60plus).toBe(30000); // 300 remains, still 60+
    expect(a.outstanding).toBe(30000);
  });

  it("a net credit balance buckets to zero everywhere", async () => {
    ledgerRows = [
      { type: "INVOICE_DEBIT", amount: D("100"), createdAt: daysAgo(10) },
      { type: "PAYMENT_CREDIT", amount: D("-150"), createdAt: daysAgo(1) },
    ];
    const a = await aging("cust_1");
    expect(a.bucket0to30).toBe(0);
    expect(a.bucket31to60).toBe(0);
    expect(a.bucket60plus).toBe(0);
    expect(a.outstanding).toBe(-5000); // customer is in credit by ₹50
  });

  it("a credit note settles the oldest debit just like a payment", async () => {
    ledgerRows = [
      { type: "INVOICE_DEBIT", amount: D("400"), createdAt: daysAgo(80) },
      { type: "INVOICE_DEBIT", amount: D("100"), createdAt: daysAgo(2) },
      { type: "CREDIT_NOTE_CREDIT", amount: D("-400"), createdAt: daysAgo(1) },
    ];
    const a = await aging("cust_1");
    expect(a.bucket60plus).toBe(0);
    expect(a.bucket0to30).toBe(10000);
  });
});

describe("ledger.outstanding — signed sum", () => {
  it("nets debits and credits to a paise outstanding (+ owes the shop)", async () => {
    ledgerRows = [
      { type: "INVOICE_DEBIT", amount: D("1000"), createdAt: daysAgo(5) },
      { type: "PAYMENT_CREDIT", amount: D("-250"), createdAt: daysAgo(1) },
    ];
    expect(await outstanding("cust_1")).toBe(75000);
  });
});
