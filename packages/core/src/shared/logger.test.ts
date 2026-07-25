import { describe, it, expect } from "vitest";
import { redact } from "./logger";

describe("logger.redact", () => {
  it("masks sensitive keys, including nested ones, and keeps the rest", () => {
    const out = redact({
      email: "a@b.com",
      password: "secret",
      nested: { gstin: "27ABCDE1234F1Z5", qty: 5 },
    }) as Record<string, unknown>;

    expect(out.email).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    const nested = out.nested as Record<string, unknown>;
    expect(nested.gstin).toBe("[redacted]");
    expect(nested.qty).toBe(5);
  });
});
