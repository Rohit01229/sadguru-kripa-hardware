import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { allocateReceipt, type AllocatableLine } from "./service";

// Spreading a delivery across the lines it was ordered on. This is the rule that
// decides whether "ordered 100, got 60" is visible, so it is worth pinning down.

const line = (
  id: string,
  productId: string,
  baseQty: string,
  receivedBaseQty = "0",
): AllocatableLine => ({ id, productId, baseQty, receivedBaseQty });

const arrived = (pairs: [string, string][]) =>
  new Map<string, Decimal.Value>(pairs as [string, Decimal.Value][]);

/** The figure a line ends up at, whether or not allocation changed it. */
function resulting(lines: AllocatableLine[], updates: { id: string; receivedBaseQty: Decimal }[]) {
  const map = new Map(lines.map((l) => [l.id, new Decimal(l.receivedBaseQty)]));
  for (const u of updates) map.set(u.id, u.receivedBaseQty);
  return map;
}

describe("allocateReceipt", () => {
  it("completes an order when everything arrives at once", () => {
    const lines = [line("l1", "cement", "100")];
    const { updates, complete } = allocateReceipt(lines, arrived([["cement", "100"]]));
    expect(complete).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.receivedBaseQty.toString()).toBe("100");
  });

  it("leaves the order PARTIAL when only some arrives", () => {
    const lines = [line("l1", "cement", "100")];
    const { updates, complete } = allocateReceipt(lines, arrived([["cement", "60"]]));
    expect(complete).toBe(false);
    expect(updates[0]!.receivedBaseQty.toString()).toBe("60");
  });

  it("accumulates across deliveries and closes on the last one", () => {
    // Second truck: 40 more against a line already showing 60 of 100.
    const lines = [line("l1", "cement", "100", "60")];
    const { updates, complete } = allocateReceipt(lines, arrived([["cement", "40"]]));
    expect(complete).toBe(true);
    expect(updates[0]!.receivedBaseQty.toString()).toBe("100");
  });

  it("does not credit an over-delivery beyond what was ordered", () => {
    // The stock movement records the true 120; the ORDER stops at 100, otherwise every
    // outstanding figure downstream would be wrong.
    const lines = [line("l1", "cement", "100")];
    const { updates, complete } = allocateReceipt(lines, arrived([["cement", "120"]]));
    expect(complete).toBe(true);
    expect(updates[0]!.receivedBaseQty.toString()).toBe("100");
  });

  it("fills the first line before spilling onto a second of the same product", () => {
    const lines = [line("l1", "cement", "50"), line("l2", "cement", "50")];
    const { updates, complete } = allocateReceipt(lines, arrived([["cement", "70"]]));
    const end = resulting(lines, updates);
    expect(end.get("l1")!.toString()).toBe("50");
    expect(end.get("l2")!.toString()).toBe("20");
    expect(complete).toBe(false);
  });

  it("ignores a product that was never ordered", () => {
    const lines = [line("l1", "cement", "100")];
    const { updates, complete } = allocateReceipt(
      lines,
      arrived([
        ["cement", "100"],
        ["sand", "999"], // supplier threw in something extra
      ]),
    );
    expect(complete).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("l1");
  });

  it("holds the order open when one of several items is missing", () => {
    const lines = [line("l1", "cement", "100"), line("l2", "sariya", "20")];
    const { complete } = allocateReceipt(lines, arrived([["cement", "100"]]));
    expect(complete).toBe(false);
  });

  it("credits nothing to a line that is already full", () => {
    const lines = [line("l1", "cement", "100", "100"), line("l2", "cement", "50")];
    const { updates } = allocateReceipt(lines, arrived([["cement", "30"]]));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("l2");
    expect(updates[0]!.receivedBaseQty.toString()).toBe("30");
  });

  it("reports complete without writing anything when the order is already full", () => {
    const lines = [line("l1", "cement", "100", "100")];
    const { updates, complete } = allocateReceipt(lines, arrived([["cement", "10"]]));
    expect(complete).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it("handles fractional base quantities exactly", () => {
    // 2.5 of 7.25 kg, then the remaining 4.75 — decimal arithmetic, not floats.
    const lines = [line("l1", "wire", "7.25", "2.5")];
    const { updates, complete } = allocateReceipt(lines, arrived([["wire", "4.75"]]));
    expect(complete).toBe(true);
    expect(updates[0]!.receivedBaseQty.toString()).toBe("7.25");
  });

  it("does not close an order when nothing arrives for it", () => {
    const lines = [line("l1", "cement", "100")];
    const { updates, complete } = allocateReceipt(lines, arrived([]));
    expect(updates).toHaveLength(0);
    expect(complete).toBe(false);
  });
});
