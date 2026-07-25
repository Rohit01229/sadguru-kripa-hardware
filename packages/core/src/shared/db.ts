// The ONLY place packages/core reaches the persistence layer (03 §1). Every
// DB-touching core service imports the client and transaction type from here so
// the import boundary ("only core imports the Prisma client") is visible in one spot.
import { Prisma, prisma } from "@hardware/db";

export { Prisma, prisma };

/**
 * The transaction-scoped Prisma client handed to a service callback by
 * `prisma.$transaction(...)`. Kernel functions (`decrementStock`,
 * `nextInvoiceNo`, `audit`, …) take a `Tx` so they compose inside the ONE
 * transaction a single user action opens (03 §2) — they never open their own.
 */
export type Tx = Prisma.TransactionClient;

/**
 * Interactive-transaction options for multi-statement service transactions.
 * Prisma's default interactive-tx timeout is 5s, which is ample in-region
 * (Vercel↔Neon round-trips are single-digit ms) but tight over a high-latency
 * link (a remote dev machine sees ~300ms/round-trip, so a 5-statement tx can
 * brush the limit). Raising it does NOT relax correctness — the gapless-numbering
 * row lock and the atomic stock guard still hold; it only avoids a spurious
 * P2028 on slow links. `maxWait` is how long to wait for a pooled connection.
 */
export const TX_OPTS = { timeout: 15_000, maxWait: 10_000 } as const;

/**
 * Run an interactive transaction with {@link TX_OPTS} applied. Use this instead of
 * `prisma.$transaction(fn)` directly so every multi-statement service tx gets the
 * same (latency-tolerant) timeout. The callback still owns the atomic boundary.
 */
export function runTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, TX_OPTS);
}

/**
 * Single-JOIN read strategy (perf). Spreading the result of `joinStrategy()` into a
 * `findMany`/`findUnique`/`findFirst` that pulls relations makes Prisma resolve the
 * whole graph in ONE SQL JOIN instead of fanning out into one extra sequential Neon
 * round-trip per relation (e.g. the catalog Product → brand/baseUnit/saleUnits/
 * saleUnits.unit/stock projection is 5 round-trips → 1). Enabled by the
 * `relationJoins` preview flag in schema.prisma (04/03 §11 perf notes).
 *
 * Capability-gated so it is safe to ship ahead of the client regeneration: the flag
 * lives in schema.prisma, but `relationLoadStrategy` only exists in the generated
 * client AFTER `prisma generate` runs. Until then, emitting the key makes the current
 * client throw PrismaClientValidationError ("Unknown argument"). We detect support
 * ONCE — by attempting a zero-row, client-side-validated probe (no DB I/O: the
 * argument validator rejects before any query is sent) — cache the result, and return
 * `{}` (the default multi-query strategy, i.e. today's behaviour) when unsupported.
 * The moment the client is regenerated the probe passes and every read using this
 * helper collapses to a single JOIN with no further code change.
 */
type JoinStrategyArg = { relationLoadStrategy: "join" } | Record<string, never>;
let joinSupport: boolean | undefined;
let joinProbe: Promise<void> | undefined;

/** Probe (once) whether the generated client accepts `relationLoadStrategy`. */
async function probeJoinSupport(): Promise<void> {
  try {
    // take:0 + a relation include exercises the argument validator without hitting the
    // DB for rows; if `relationLoadStrategy` is unknown the client throws synchronously
    // during call construction, so this never costs a Neon round-trip in either branch.
    await (prisma.product.findMany as (args: unknown) => Promise<unknown>)({
      take: 0,
      relationLoadStrategy: "join",
      select: { id: true },
    });
    joinSupport = true;
  } catch {
    // ANY thrown error means the CURRENT generated client does not accept the argument —
    // the usual case is the "unknown argument relationLoadStrategy" validation error before
    // `prisma generate`, but it could equally be an instanceof mismatch across client copies
    // or a transient DB error. The safe default is the multi-query strategy (today's
    // behaviour). The previous logic inverted this: a non-validation error set
    // joinSupport=true, which then emitted relationLoadStrategy into every relation read and
    // made the catalog throw PrismaClientValidationError. Only a SUCCESSFUL probe proves
    // support, so any failure ⇒ unsupported ⇒ return {}.
    joinSupport = false;
  }
}

/**
 * Returns `{ relationLoadStrategy: "join" }` when the generated client supports it,
 * else `{}`. First call kicks off the one-time probe; callers `await` it. Spread into
 * a relation-loading read: `findMany({ ...(await joinStrategy()), include, ... })`.
 */
export async function joinStrategy(): Promise<JoinStrategyArg> {
  if (joinSupport === undefined) {
    joinProbe ??= probeJoinSupport();
    await joinProbe;
  }
  return joinSupport ? { relationLoadStrategy: "join" } : {};
}
