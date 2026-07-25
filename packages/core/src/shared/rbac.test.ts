import { describe, it, expect } from "vitest";
import { can, requirePermission, type Session } from "./rbac";
import { Forbidden } from "./errors";

const cashier: Session = {
  userId: "u1",
  realm: "STAFF",
  permissions: ["bill.pakka.create", "bill.kacha.create", "ledger.write"],
};

describe("rbac", () => {
  it("grants a held permission", () => {
    expect(can(cashier, "bill.pakka.create")).toBe(true);
  });
  it("denies a missing permission", () => {
    expect(can(cashier, "bill.cancel")).toBe(false);
  });
  it("requirePermission throws Forbidden when missing", () => {
    expect(() => requirePermission(cashier, "bill.cancel")).toThrow(Forbidden);
  });
});
