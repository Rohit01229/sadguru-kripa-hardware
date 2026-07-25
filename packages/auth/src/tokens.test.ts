import { describe, it, expect } from "vitest";
import { issueToken, verifyToken, hashToken, type TokenRecord } from "./tokens";

describe("tokens", () => {
  it("issues a token whose stored hash matches and expires in the future", () => {
    const t = issueToken(30);
    expect(t.tokenHash).toBe(hashToken(t.token));
    expect(t.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("verifies a valid, unused, unexpired token", () => {
    const t = issueToken(30);
    const rec: TokenRecord = { tokenHash: t.tokenHash, expiresAt: t.expiresAt, usedAt: null };
    expect(verifyToken(t.token, rec)).toBe(true);
  });

  it("rejects expired, used, or wrong tokens", () => {
    const t = issueToken(30);
    expect(
      verifyToken(t.token, {
        tokenHash: t.tokenHash,
        expiresAt: new Date(Date.now() - 1_000),
        usedAt: null,
      }),
    ).toBe(false);
    expect(
      verifyToken(t.token, { tokenHash: t.tokenHash, expiresAt: t.expiresAt, usedAt: new Date() }),
    ).toBe(false);
    expect(
      verifyToken("not-the-token", {
        tokenHash: t.tokenHash,
        expiresAt: t.expiresAt,
        usedAt: null,
      }),
    ).toBe(false);
  });
});
