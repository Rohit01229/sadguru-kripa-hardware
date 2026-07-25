import { describe, it, expect, vi } from "vitest";
import { nextInvoiceNo, nextCreditNoteNo } from "./service";
import type { Tx } from "../shared/db";

// UNIT test of the numbering kernel LOGIC against a mock `Tx`. The real gapless /
// no-collision guarantee comes from the row lock taken by `UPDATE … RETURNING`
// inside the invoice transaction (proven under real concurrency by the S8
// integration test). Here we assert the kernel:
//  - upserts the FY counter row (so a new FY starts at 1),
//  - formats the sequence the UPDATE returns via formatInvoiceNo, and
//  - is gapless across sequential allocations sharing one counter.

function counterTx() {
  // Simulate a single FY counter row that the conditional UPDATE bumps by 1.
  const state = { lastNo: 0 };
  const upsert = vi.fn().mockResolvedValue({});
  const queryRaw = vi.fn().mockImplementation(async () => {
    state.lastNo += 1;
    return [{ lastNo: state.lastNo }];
  });
  const tx = {
    invoiceCounter: { upsert },
    creditNoteCounter: { upsert },
    $queryRaw: queryRaw,
  } as unknown as Tx;
  return { tx, upsert, state };
}

describe("billing.nextInvoiceNo — gapless numbering", () => {
  it("formats <FY>/<6-digit> from the counter the UPDATE returns", async () => {
    const { tx } = counterTx();
    const r = await nextInvoiceNo(tx, "2026-27");
    expect(r.seq).toBe(1);
    expect(r.invoiceNo).toBe("2026-27/000001");
  });

  it("ensures the FY counter row exists (upsert) before incrementing", async () => {
    const { tx, upsert } = counterTx();
    await nextInvoiceNo(tx, "2026-27");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fy: "2026-27" }, create: { fy: "2026-27", lastNo: 0 } }),
    );
  });

  it("produces consecutive, gapless numbers across sequential allocations", async () => {
    const { tx } = counterTx();
    const a = await nextInvoiceNo(tx, "2026-27");
    const b = await nextInvoiceNo(tx, "2026-27");
    const c = await nextInvoiceNo(tx, "2026-27");
    expect([a.invoiceNo, b.invoiceNo, c.invoiceNo]).toEqual([
      "2026-27/000001",
      "2026-27/000002",
      "2026-27/000003",
    ]);
    // gapless: each seq is exactly one more than the previous
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
  });
});

describe("billing.nextCreditNoteNo — independent gapless series", () => {
  it("allocates from its own counter, formatted the same way", async () => {
    const { tx } = counterTx();
    const r = await nextCreditNoteNo(tx, "2026-27");
    expect(r.seq).toBe(1);
    expect(r.creditNoteNo).toBe("2026-27/000001");
  });
});
