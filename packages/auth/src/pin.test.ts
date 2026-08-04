import { describe, it, expect } from "vitest";
import { isWeakPin, newDeviceToken, safeEqual, MAX_ATTEMPTS, PIN_LENGTH } from "./pin";

// The DB-touching paths (set/verify/lock) are exercised end-to-end against a real
// database in the integration probe; these cover the pure logic that decides whether a
// 4-digit secret is safe enough to accept, plus the token generator.

describe("isWeakPin", () => {
  it("rejects anything that is not exactly four digits", () => {
    expect(isWeakPin("123")).toBe(true);
    expect(isWeakPin("12345")).toBe(true);
    expect(isWeakPin("12a4")).toBe(true);
    expect(isWeakPin("")).toBe(true);
    expect(isWeakPin(" 1234 ")).toBe(true);
  });

  it("rejects repeated digits", () => {
    for (const p of ["0000", "1111", "5555", "9999"]) {
      expect(isWeakPin(p), p).toBe(true);
    }
  });

  it("rejects straight runs up and down, including ones that wrap", () => {
    for (const p of ["1234", "2345", "6789", "4321", "9876", "9012", "1098"]) {
      expect(isWeakPin(p), p).toBe(true);
    }
  });

  it("accepts an ordinary PIN", () => {
    for (const p of ["1357", "8402", "6143", "2580"]) {
      expect(isWeakPin(p), p).toBe(false);
    }
  });

  it("guards the shape the UI promises", () => {
    expect(PIN_LENGTH).toBe(4);
    // Small enough that the lockout is what keeps it safe — keep this deliberate.
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe("newDeviceToken", () => {
  it("is long and URL-safe", () => {
    const t = newDeviceToken();
    // 32 random bytes → 43 base64url chars.
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newDeviceToken()));
    expect(seen.size).toBe(200);
  });
});

describe("safeEqual", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    // Different lengths must not throw — timingSafeEqual would, so we length-check first.
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
