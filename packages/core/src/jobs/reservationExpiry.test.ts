import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DecimalModule from "decimal.js";

// S7 reservation-expiry IDEMPOTENCY test (03 §5, §10; 14 Chunk 11 gate). The job must
// be safe to retry: QStash redelivers on failure, so a SECOND run must release nothing
// more (the first flipped the expired rows to EXPIRED). We mock the db with an
// in-memory reservation store: releaseExpired only acts on status==="ACTIVE" rows past
// expiresAt, so once they are EXPIRED a re-run is a no-op. The kernel's releaseExpired
// is the real code under test (imported through the job).

interface Res {
  id: string;
  productId: string;
  baseQty: { toString(): string };
  status: string;
  expiresAt: Date;
}

let reservations: Res[] = [];
// Track ProductStock.reserved decrements the raw UPDATE would apply.
let reservedDecrements: { productId: string; qty: string }[] = [];
let auditRows: { action: string }[] = [];

vi.mock("../shared/db", async () => {
  const decimal = await vi.importActual<typeof DecimalModule>("decimal.js");
  const PrismaDecimal = decimal.default;
  const tx = {
    reservation: {
      findMany: vi.fn(async ({ where }: { where: { status: string; expiresAt: { lt: Date } } }) =>
        reservations
          .filter((r) => r.status === where.status && r.expiresAt < where.expiresAt.lt)
          .map((r) => ({ id: r.id, productId: r.productId, baseQty: r.baseQty })),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const row = reservations.find((r) => r.id === where.id);
        if (row) row.status = data.status;
        return row;
      }),
    },
    // releaseExpired uses tx.$executeRaw to decrement ProductStock.reserved; record it.
    $executeRaw: vi.fn(async (..._args: unknown[]) => {
      // We cannot easily parse the tagged template; for idempotency we only need to
      // count how many times a decrement was attempted (once per expired row).
      reservedDecrements.push({ productId: "tracked", qty: "n/a" });
      return 1;
    }),
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string } }) => {
        auditRows.push({ action: data.action });
        return { id: `aud_${auditRows.length}` };
      }),
    },
  };
  return {
    prisma: {},
    Prisma: { Decimal: PrismaDecimal },
    runTx: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
});

import { runReservationExpiry } from "./service";

const D = (v: string) => ({ toString: () => v });

describe("jobs.runReservationExpiry — idempotent release", () => {
  beforeEach(() => {
    reservedDecrements = [];
    auditRows = [];
    reservations = [
      { id: "r1", productId: "p1", baseQty: D("5"), status: "ACTIVE", expiresAt: new Date("2026-06-29T09:00:00Z") },
      { id: "r2", productId: "p2", baseQty: D("3"), status: "ACTIVE", expiresAt: new Date("2026-06-29T09:30:00Z") },
      { id: "r3", productId: "p3", baseQty: D("2"), status: "ACTIVE", expiresAt: new Date("2026-06-29T12:00:00Z") }, // not yet expired
    ];
  });

  it("releases only ACTIVE reservations past expiry on the first run", async () => {
    const now = new Date("2026-06-29T10:00:00Z");
    const res = await runReservationExpiry(now);
    expect(res.released).toBe(2); // r1 + r2 expired; r3 not yet
    expect(reservations.find((r) => r.id === "r1")!.status).toBe("EXPIRED");
    expect(reservations.find((r) => r.id === "r2")!.status).toBe("EXPIRED");
    expect(reservations.find((r) => r.id === "r3")!.status).toBe("ACTIVE");
    expect(auditRows).toHaveLength(1); // audited once (something was freed)
    expect(auditRows[0]!.action).toBe("job.reservation-expiry");
  });

  it("a SECOND run releases nothing more (idempotent redelivery)", async () => {
    const now = new Date("2026-06-29T10:00:00Z");
    await runReservationExpiry(now);
    reservedDecrements = [];
    auditRows = [];
    const second = await runReservationExpiry(now);
    expect(second.released).toBe(0); // already EXPIRED — no double-free
    expect(reservedDecrements).toHaveLength(0); // no stock decremented twice
    expect(auditRows).toHaveLength(0); // no audit when nothing freed
  });

  it("releases r3 once its own expiry passes on a later run", async () => {
    await runReservationExpiry(new Date("2026-06-29T10:00:00Z"));
    const later = await runReservationExpiry(new Date("2026-06-29T13:00:00Z"));
    expect(later.released).toBe(1); // r3 now expired
    expect(reservations.find((r) => r.id === "r3")!.status).toBe("EXPIRED");
  });
});
