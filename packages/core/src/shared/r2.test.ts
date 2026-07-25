import { describe, it, expect } from "vitest";
import { getR2Config, isR2Configured, signGetUrl } from "./r2";

// S7 R2 signed-URL unit tests (07 §8 security finishing). The SigV4 query-signing is
// PURE crypto — deterministic given creds + a fixed clock — so it is testable with
// DUMMY creds and NO network. Also asserts the graceful-degradation contract: with no
// creds, signGetUrl returns null (callers fall back to a placeholder).

const ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  R2_BUCKET: "hardware-prod",
} as unknown as NodeJS.ProcessEnv;

describe("r2.getR2Config / isR2Configured — graceful degradation", () => {
  it("returns null when any required var is empty (no crash)", () => {
    expect(getR2Config({} as NodeJS.ProcessEnv)).toBeNull();
    expect(isR2Configured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(getR2Config({ R2_ACCOUNT_ID: "x" } as NodeJS.ProcessEnv)).toBeNull();
  });
  it("returns config when all four vars are present", () => {
    expect(getR2Config(ENV)).toEqual({
      accountId: "acct123",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bucket: "hardware-prod",
    });
    expect(isR2Configured(ENV)).toBe(true);
  });
});

describe("r2.signGetUrl — SigV4 presigned GET", () => {
  it("resolves to null when R2 is not configured (runtime-deferred)", async () => {
    expect(await signGetUrl("images/x.png", 300, new Date(), {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("produces a deterministic, well-formed presigned URL", async () => {
    const at = new Date("2026-06-29T10:00:00Z");
    const url = (await signGetUrl("images/wire.png", 600, at, ENV))!;
    expect(url).toContain("https://acct123.r2.cloudflarestorage.com/hardware-prod/images/wire.png?");
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Expires=600");
    expect(url).toContain("X-Amz-Date=20260629T100000Z");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
    // Deterministic: same inputs → same signature.
    const url2 = (await signGetUrl("images/wire.png", 600, at, ENV))!;
    expect(url2).toBe(url);
  });

  it("a different key yields a different signature", async () => {
    const at = new Date("2026-06-29T10:00:00Z");
    const a = (await signGetUrl("images/a.png", 600, at, ENV))!;
    const b = (await signGetUrl("images/b.png", 600, at, ENV))!;
    expect(a).not.toBe(b);
  });

  it("clamps expiry into the SigV4 1s..7d window", async () => {
    const at = new Date("2026-06-29T10:00:00Z");
    const tooLong = (await signGetUrl("x", 99_999_999, at, ENV))!;
    expect(tooLong).toContain("X-Amz-Expires=604800");
    const tooShort = (await signGetUrl("x", 0, at, ENV))!;
    expect(tooShort).toContain("X-Amz-Expires=1");
  });
});
