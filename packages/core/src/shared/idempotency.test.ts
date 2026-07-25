import { describe, it, expect } from "vitest";
import { hashRequest } from "./idempotency";

// The idempotency replay/mismatch contract (04 §5) hinges on a STABLE request hash:
// the same logical body must hash identically regardless of key order, and a
// different body must hash differently (→ IDEMPOTENCY_MISMATCH / 409). The DB
// lookup/store path is exercised by the GRN integration flow; here we pin the hash.

describe("idempotency.hashRequest — stable, order-independent", () => {
  it("hashes identical bodies identically", () => {
    const a = { supplierId: "s1", lines: [{ productId: "p1", quantity: "5" }] };
    const b = { supplierId: "s1", lines: [{ productId: "p1", quantity: "5" }] };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("is independent of object key order", () => {
    const a = { supplierId: "s1", note: "n" };
    const b = { note: "n", supplierId: "s1" };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("changes when any value changes (mismatch detection)", () => {
    const a = { supplierId: "s1", lines: [{ productId: "p1", quantity: "5" }] };
    const b = { supplierId: "s1", lines: [{ productId: "p1", quantity: "6" }] };
    expect(hashRequest(a)).not.toBe(hashRequest(b));
  });
});
