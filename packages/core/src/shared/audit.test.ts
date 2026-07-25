import { describe, it, expect, vi } from "vitest";
import { audit } from "./audit";
import { Prisma } from "./db";
import type { Tx } from "./db";

describe("audit", () => {
  it("inserts an AuditLog row via the supplied tx and returns its id", async () => {
    const create = vi.fn().mockResolvedValue({ id: "a1" });
    const tx = { auditLog: { create } } as unknown as Tx;

    const id = await audit(tx, {
      actorStaffId: "u1",
      roleAtTime: "OWNER",
      permissionUsed: "bill.pakka.create",
      action: "bill.pakka.create",
      targetType: "Invoice",
      targetId: "inv1",
      after: { invoiceNo: "2026-27/000001" },
      requestId: "req-123",
    });

    expect(id).toBe("a1");
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0].data;
    expect(data.action).toBe("bill.pakka.create");
    expect(data.permissionUsed).toBe("bill.pakka.create");
    expect(data.requestId).toBe("req-123");
  });

  it("normalises undefined before/after to Prisma.JsonNull (Json columns reject undefined)", async () => {
    const create = vi.fn().mockResolvedValue({ id: "a2" });
    const tx = { auditLog: { create } } as unknown as Tx;

    await audit(tx, { action: "stock.adjust" });
    const data = create.mock.calls[0]![0].data;
    expect(data.before).toBe(Prisma.JsonNull);
    expect(data.after).toBe(Prisma.JsonNull);
    // unattributed act (e.g. kacha stock-out): actor is null, not undefined
    expect(data.actorStaffId).toBeNull();
  });
});
