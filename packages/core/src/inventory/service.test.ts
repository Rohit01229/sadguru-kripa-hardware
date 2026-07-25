import { describe, it, expect, vi } from "vitest";
import Decimal from "decimal.js";
import { decrementStock, incrementStock, reserve } from "./service";
import { InsufficientStock } from "../shared/errors";
import type { Tx } from "../shared/db";

// These are UNIT tests of the kernel's atomic-guard LOGIC against a mock `Tx`:
// the real check-and-decrement is a single conditional SQL UPDATE whose affected
// -row count is the gate. We assert (a) 0 rows ⇒ InsufficientStock and NO movement
// written, and (b) ≥1 row ⇒ a correctly-signed movement is written. The genuine
// concurrency / no-oversell proof against real Postgres is the S8 integration test
// (14-implementation-plan Chunk 12).

function mockTx(affectedRows: number) {
  const movementCreate = vi.fn().mockResolvedValue({ id: "mv1" });
  const reservationCreate = vi.fn().mockResolvedValue({ id: "rsv1" });
  const stockUpsert = vi.fn().mockResolvedValue({});
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(affectedRows),
    stockMovement: { create: movementCreate },
    reservation: { create: reservationCreate },
    productStock: { upsert: stockUpsert },
  } as unknown as Tx;
  return { tx, movementCreate, reservationCreate, stockUpsert };
}

describe("inventory.decrementStock — atomic guard", () => {
  it("throws InsufficientStock and writes no movement when the guarded UPDATE affects 0 rows", async () => {
    const { tx, movementCreate } = mockTx(0);
    await expect(decrementStock(tx, "p1", "5", "SALE_OUT")).rejects.toBeInstanceOf(
      InsufficientStock,
    );
    expect(movementCreate).not.toHaveBeenCalled();
  });

  it("writes a single negative-signed movement when the UPDATE succeeds (1 row)", async () => {
    const { tx, movementCreate } = mockTx(1);
    await decrementStock(tx, "p1", "5", "SALE_OUT", { refType: "INVOICE", refId: "inv1" });
    expect(movementCreate).toHaveBeenCalledTimes(1);
    const data = movementCreate.mock.calls[0]![0].data;
    expect(new Decimal(data.baseQty.toString()).toNumber()).toBe(-5); // signed − out
    expect(data.kind).toBe("SALE_OUT");
    expect(data.refType).toBe("INVOICE");
  });

  it("rejects a zero or negative quantity at the boundary", async () => {
    const { tx } = mockTx(1);
    await expect(decrementStock(tx, "p1", "0", "SALE_OUT")).rejects.toBeInstanceOf(
      InsufficientStock,
    );
    await expect(decrementStock(tx, "p1", "-2", "SALE_OUT")).rejects.toBeInstanceOf(
      InsufficientStock,
    );
  });

  it("allowNegative bypasses the availability guard but still records the movement", async () => {
    // Even with 0 'available', allowNegative path returns affected rows from the
    // unconditional UPDATE; assert the movement is still written.
    const { tx, movementCreate } = mockTx(1);
    await decrementStock(tx, "p1", "3", "ADJUST_OUT", {}, true);
    expect(movementCreate).toHaveBeenCalledTimes(1);
  });
});

describe("inventory.incrementStock", () => {
  it("upserts stock and writes a positive-signed movement", async () => {
    const { tx, movementCreate, stockUpsert } = mockTx(1);
    await incrementStock(tx, "p1", "450", "GRN_IN", { refType: "GRN", refId: "grn1" });
    expect(stockUpsert).toHaveBeenCalledTimes(1);
    const data = movementCreate.mock.calls[0]![0].data;
    expect(new Decimal(data.baseQty.toString()).toNumber()).toBe(450); // signed + in
    expect(data.kind).toBe("GRN_IN");
  });
});

describe("inventory.reserve — availability guard", () => {
  it("throws InsufficientStock when the reserve UPDATE affects 0 rows", async () => {
    const { tx, reservationCreate } = mockTx(0);
    await expect(
      reserve(tx, "o1", "p1", "5", new Date(Date.now() + 60_000)),
    ).rejects.toBeInstanceOf(InsufficientStock);
    expect(reservationCreate).not.toHaveBeenCalled();
  });

  it("creates a Reservation row when availability allows", async () => {
    const { tx, reservationCreate } = mockTx(1);
    const id = await reserve(tx, "o1", "p1", "5", new Date(Date.now() + 60_000));
    expect(id).toBe("rsv1");
    expect(reservationCreate).toHaveBeenCalledTimes(1);
  });
});
