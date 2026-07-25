import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password (argon2id)", () => {
  it("hashes then verifies the correct password", async () => {
    const hash = await hashPassword("Sup3r-Secret!");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword("Sup3r-Secret!", hash)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });
});
