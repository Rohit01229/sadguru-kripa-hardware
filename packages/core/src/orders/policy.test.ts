import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { deliveryFee, generateOrderNo } from "./service";

// PURE policy helpers (no DB) — the delivery-fee rule (13 §10) and order numbering.

describe("orders.deliveryFee — flat fee + free-above-threshold (13 §10)", () => {
  it("charges the flat fee for a DELIVERY below the free threshold", () => {
    expect(deliveryFee("DELIVERY", 1000, 50, 2000).toNumber()).toBe(50);
  });

  it("is free once the item total reaches the free-delivery threshold", () => {
    expect(deliveryFee("DELIVERY", 2000, 50, 2000).toNumber()).toBe(0);
    expect(deliveryFee("DELIVERY", 2500, 50, 2000).toNumber()).toBe(0);
  });

  it("charges the flat fee when no free threshold is configured (null)", () => {
    expect(deliveryFee("DELIVERY", 999999, 50, null).toNumber()).toBe(50);
  });

  it("is always free for PICKUP regardless of total/threshold", () => {
    expect(deliveryFee("PICKUP", 10, 50, 2000).toNumber()).toBe(0);
    expect(deliveryFee("PICKUP", 10, 50, null).toNumber()).toBe(0);
  });

  it("uses Decimal (no float drift) for the comparison", () => {
    // 0.1 + 0.2 territory: threshold exactly equal must be free.
    const fee = deliveryFee("DELIVERY", new Decimal("0.3"), 5, new Decimal("0.3"));
    expect(fee.toNumber()).toBe(0);
  });
});

describe("orders.generateOrderNo", () => {
  it("produces an ORD- prefixed, unique-ish number", () => {
    const a = generateOrderNo(new Date("2026-06-28T10:00:00Z"), "AAAA");
    expect(a).toMatch(/^ORD-[0-9A-Z]+-AAAA$/);
  });

  it("differs when the random suffix differs (collision resistance)", () => {
    const t = new Date("2026-06-28T10:00:00Z");
    expect(generateOrderNo(t, "AAAA")).not.toBe(generateOrderNo(t, "BBBB"));
  });
});
