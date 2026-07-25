import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// Filter logic added to the ledger reads (additive, no behaviour change for callers
// that pass no filter): listCustomers gains hasOutstanding + agingBucket; getStatement
// gains a from/to window with a carried opening balance. Decimal.js is real; only the
// db layer is mocked. Per-customer ledger rows drive the derived outstanding/aging.

const DAY = 24 * 60 * 60 * 1000;
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

interface LedgerRow {
  id?: string;
  type: string;
  amount: unknown;
  createdAt: Date;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
}
interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  type: "RETAIL" | "WHOLESALE";
  creditLimit: unknown | null;
  createdAt: Date;
}

// Mutable fixtures the mocked prisma reads.
let customers: CustomerRow[] = [];
let ledgerByCustomer: Record<string, LedgerRow[]> = {};

vi.mock("../shared/db", async () => {
  const actual = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = actual.default;
  const rowsFor = (where: { customerId?: string } | undefined): LedgerRow[] =>
    where?.customerId ? (ledgerByCustomer[where.customerId] ?? []) : [];
  return {
    prisma: {
      customer: {
        findMany: vi.fn(async () => customers),
        findUnique: vi.fn(async (args: { where: { id: string } }) => {
          const c = customers.find((x) => x.id === args.where.id);
          return c ? { id: c.id, name: c.name } : null;
        }),
      },
      ledgerEntry: {
        findMany: vi.fn(async (args: { where?: { customerId?: string } }) => rowsFor(args?.where)),
        aggregate: vi.fn(async (args: { where?: { customerId?: string } }) => {
          const sum = rowsFor(args?.where).reduce(
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

import { listCustomers, getStatement, inAgingBucket } from "./service";
import { Prisma } from "../shared/db";

const D = (v: string) => new Prisma.Decimal(v);

function customer(id: string, name: string): CustomerRow {
  return { id, name, phone: null, gstin: null, type: "RETAIL", creditLimit: null, createdAt: new Date() };
}

describe("ledger.inAgingBucket — bucket predicate", () => {
  const base = { customerId: "c", outstanding: 0, bucket0to30: 0, bucket31to60: 0, bucket60plus: 0 };
  it("matches current when 0-30 bucket is positive", () => {
    expect(inAgingBucket({ ...base, bucket0to30: 100 }, "current")).toBe(true);
    expect(inAgingBucket({ ...base, bucket0to30: 100 }, "b31to60")).toBe(false);
  });
  it("matches b31to60 and b60plus by their buckets", () => {
    expect(inAgingBucket({ ...base, bucket31to60: 5 }, "b31to60")).toBe(true);
    expect(inAgingBucket({ ...base, bucket60plus: 5 }, "b60plus")).toBe(true);
    expect(inAgingBucket({ ...base, bucket60plus: 5 }, "current")).toBe(false);
  });
});

describe("ledger.listCustomers — additive filters", () => {
  beforeEach(() => {
    customers = [customer("c_owes", "Owes Co"), customer("c_clear", "Clear Co"), customer("c_credit", "Credit Co")];
    ledgerByCustomer = {
      c_owes: [{ type: "INVOICE_DEBIT", amount: D("1000"), createdAt: daysAgo(5) }], // owes 1000
      c_clear: [
        { type: "INVOICE_DEBIT", amount: D("500"), createdAt: daysAgo(5) },
        { type: "PAYMENT_CREDIT", amount: D("-500"), createdAt: daysAgo(1) },
      ], // settled
      c_credit: [{ type: "PAYMENT_CREDIT", amount: D("-200"), createdAt: daysAgo(1) }], // in credit
    };
  });

  it("returns ALL customers (with full cursor pagination) when no filter is passed", async () => {
    const page = await listCustomers({});
    expect(page.data.map((c) => c.id).sort()).toEqual(["c_clear", "c_credit", "c_owes"]);
    // Default (non-derived) path keeps a real pageInfo shape.
    expect(page.pageInfo).toHaveProperty("nextCursor");
  });

  it("hasOutstanding keeps only customers whose net balance > 0", async () => {
    const page = await listCustomers({ hasOutstanding: true });
    expect(page.data.map((c) => c.id)).toEqual(["c_owes"]);
    // The matched DTO carries the computed outstanding (paise).
    expect(page.data[0]!.outstanding).toBe(100000);
    // Derived filter disables cursor pagination (first page only).
    expect(page.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
  });

  it("agingBucket=current selects customers with fresh (0-30d) unpaid debt", async () => {
    const page = await listCustomers({ agingBucket: "current" });
    expect(page.data.map((c) => c.id)).toEqual(["c_owes"]);
  });

  it("agingBucket=b60plus excludes a customer whose debt is only recent", async () => {
    const page = await listCustomers({ agingBucket: "b60plus" });
    expect(page.data).toEqual([]);
  });
});

describe("ledger.getStatement — from/to window with carried opening balance", () => {
  beforeEach(() => {
    customers = [customer("c1", "Acme")];
    ledgerByCustomer = {
      c1: [
        { id: "e1", type: "INVOICE_DEBIT", amount: D("1000"), createdAt: daysAgo(40) },
        { id: "e2", type: "PAYMENT_CREDIT", amount: D("-400"), createdAt: daysAgo(20) },
        { id: "e3", type: "INVOICE_DEBIT", amount: D("300"), createdAt: daysAgo(2) },
      ],
    };
  });

  it("returns the whole ledger (opening 0) when no window is given", async () => {
    const s = await getStatement("c1");
    expect(s.entries).toHaveLength(3);
    expect(s.openingBalance).toBe(0);
    expect(s.outstanding).toBe(90000); // 1000 − 400 + 300 = 900
    // Running balance is cumulative from 0.
    expect(s.entries.map((e) => e.balance)).toEqual([100000, 60000, 90000]);
  });

  it("folds entries before `from` into openingBalance, keeps running balance correct", async () => {
    const from = daysAgo(10).toISOString();
    const s = await getStatement("c1", { from });
    // Only the 2-day-old debit is in-window; the first two fold into opening (600).
    expect(s.entries.map((e) => e.id)).toEqual(["e3"]);
    expect(s.openingBalance).toBe(60000); // 1000 − 400
    expect(s.entries[0]!.balance).toBe(90000); // opening + 300, continues the run
    // outstanding is the WHOLE-ledger closing balance, unaffected by the window.
    expect(s.outstanding).toBe(90000);
  });

  it("`to` excludes later entries from the rows but not from outstanding", async () => {
    const to = daysAgo(10).toISOString();
    const s = await getStatement("c1", { to });
    expect(s.entries.map((e) => e.id)).toEqual(["e1", "e2"]); // e3 (2d ago) excluded
    expect(s.outstanding).toBe(90000); // still the full-ledger closing balance
  });
});
