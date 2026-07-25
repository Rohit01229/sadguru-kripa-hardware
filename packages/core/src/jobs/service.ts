// Background-job core functions (S7; 03 §10, 14-impl-plan Chunk 11). The scheduled
// spine is Vercel Cron → QStash → an AUTHENTICATED route handler that calls one of
// these (the auth lives at transport — CRON_SECRET / QStash signature). EVERY job
// here is IDEMPOTENT and safe to retry: each operates on a QUERY of current state
// (e.g. "reservations past expiry", "batches with onHand drift") rather than assuming
// exactly-once delivery, so QStash redelivery never double-applies (03 §10).
//
// Jobs are framework-free plain TS (no Next/React — 03 §1). They open their own ONE
// prisma.$transaction where a mutation is needed (these are SYSTEM actions, not user
// actions, so a job is its own atomic unit). System mutations are audited with a null
// actor (10 §7 — auth events / system acts).
//
//  runReservationExpiry  — release reservations past expiresAt (inventory.releaseExpired).
//  runKhataReminders     — recompute aging; collect overdue customers to remind.
//  runDayEndRollup       — compute the prior day's summary (read-only snapshot).
//  runLowStockAlerts     — collect items at/below reorder level.
//  runNearExpiryAlerts   — collect batches nearing/at expiry.
//  runBatchReconciliation— fix Batch.onHand ↔ ProductStock.onHand drift (13 §5 TBD).
//  runBackup             — encrypted pg_dump → R2 (runtime-deferred without R2 creds).
import Decimal from "decimal.js";
import { Prisma, prisma, runTx } from "../shared/db";
import { audit } from "../shared/audit";
import { releaseExpired } from "../inventory/service";
import { lowStock } from "../inventory/service";
import { nearExpiry } from "../inventory/service";
import { dayEnd, type DayEndDTO } from "../reports/service";

// ─────────────────── Reservation expiry ───────────────────
export interface ReservationExpiryResult {
  job: "reservation-expiry";
  released: number;
  at: string;
}

/**
 * Release every ACTIVE reservation past its expiresAt, freeing available stock
 * (03 §5, §10). ONE tx via the inventory kernel's releaseExpired, which only ever
 * acts on still-ACTIVE rows → idempotent: a second run releases nothing more (the
 * first flipped them to EXPIRED). Audited as a system act when anything was freed.
 */
export async function runReservationExpiry(now: Date = new Date()): Promise<ReservationExpiryResult> {
  const { released } = await runTx(async (tx) => {
    const res = await releaseExpired(tx, now);
    if (res.released > 0) {
      await audit(tx, {
        actorStaffId: null,
        roleAtTime: "SYSTEM",
        permissionUsed: null,
        action: "job.reservation-expiry",
        targetType: "Reservation",
        targetId: null,
        after: { released: res.released },
        requestId: null,
      });
    }
    return res;
  });
  return { job: "reservation-expiry", released, at: now.toISOString() };
}

// ─────────────────── Khata reminders ───────────────────
export interface KhataReminderCustomer {
  customerId: string;
  name: string;
  outstanding: number; // paise
  bucket0to30: number;
  bucket31to60: number;
  bucket60plus: number;
}
export interface KhataReminderResult {
  job: "khata-reminders";
  /** Customers with an overdue (31+ day) balance who should be reminded. */
  overdue: KhataReminderCustomer[];
  reminded: number;
  at: string;
}

/**
 * Recompute aging across all customers and collect those with an OVERDUE balance
 * (anything in the 31-60 or 60+ buckets). Read-only computation; the actual send is
 * delegated to the caller's notify arm (Resend/MSG91 in transport — runtime-deferred
 * without creds). Idempotent: it recomputes current state each run, so a redelivery
 * produces the same list (no double-charge of state). `notify` lets the route hand a
 * sender in without coupling core to a mail provider.
 */
export async function runKhataReminders(
  notify?: (c: KhataReminderCustomer) => Promise<void>,
  now: Date = new Date(),
): Promise<KhataReminderResult> {
  // Net each customer's ledger, then age only those in debit. We fold in JS to reuse
  // the same FIFO aging logic shape as ledger.aging without N round-trips.
  const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
  const overdue: KhataReminderCustomer[] = [];
  const DAY = 24 * 60 * 60 * 1000;

  for (const c of customers) {
    const rows = await prisma.ledgerEntry.findMany({
      where: { customerId: c.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { amount: true, createdAt: true },
    });
    if (rows.length === 0) continue;

    const debits: { remaining: Decimal; createdAt: Date }[] = [];
    let creditPool = new Decimal(0);
    for (const e of rows) {
      if (new Decimal(e.amount).gt(0)) debits.push({ remaining: new Decimal(e.amount), createdAt: e.createdAt });
      else if (new Decimal(e.amount).lt(0)) creditPool = creditPool.plus(new Decimal(e.amount).abs());
    }
    for (const d of debits) {
      if (creditPool.lte(0)) break;
      const applied = Decimal.min(d.remaining, creditPool);
      d.remaining = d.remaining.minus(applied);
      creditPool = creditPool.minus(applied);
    }
    let b0 = new Decimal(0);
    let b31 = new Decimal(0);
    let b60 = new Decimal(0);
    for (const d of debits) {
      if (d.remaining.lte(0)) continue;
      const ageDays = Math.floor((now.getTime() - d.createdAt.getTime()) / DAY);
      if (ageDays <= 30) b0 = b0.plus(d.remaining);
      else if (ageDays <= 60) b31 = b31.plus(d.remaining);
      else b60 = b60.plus(d.remaining);
    }
    const overdueAmt = b31.plus(b60);
    if (overdueAmt.gt(0)) {
      overdue.push({
        customerId: c.id,
        name: c.name,
        outstanding: b0.plus(b31).plus(b60).times(100).round().toNumber(),
        bucket0to30: b0.times(100).round().toNumber(),
        bucket31to60: b31.times(100).round().toNumber(),
        bucket60plus: b60.times(100).round().toNumber(),
      });
    }
  }

  let reminded = 0;
  if (notify) {
    for (const c of overdue) {
      try {
        await notify(c);
        reminded += 1;
      } catch {
        // Best-effort: a single send failure must not fail the whole job (idempotent
        // — the next run re-collects the same overdue customer).
      }
    }
  }

  return { job: "khata-reminders", overdue, reminded, at: now.toISOString() };
}

// ─────────────────── Day-end roll-up ───────────────────
export interface DayEndRollupResult {
  job: "day-end-rollup";
  summary: DayEndDTO;
  at: string;
}

/**
 * Nightly day-end roll-up: snapshot the PRIOR day's pakka summary (kacha excluded)
 * for the dashboard/reports. Read-only (the report itself is derived, not stored —
 * 13 reports note), so it is trivially idempotent. Defaults to "yesterday" relative
 * to `now` since the cron runs after midnight.
 */
export async function runDayEndRollup(now: Date = new Date()): Promise<DayEndRollupResult> {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const summary = await dayEnd({ date: yesterday });
  return { job: "day-end-rollup", summary, at: now.toISOString() };
}

// ─────────────────── Low-stock / near-expiry alerts ───────────────────
export interface LowStockAlertResult {
  job: "low-stock-alerts";
  items: { productId: string; sku: string; name: string; onHand: string; reorderLevel: string | null }[];
  count: number;
  at: string;
}

/** Collect items at/below reorder level (read-only; alert source — 03 §10). Idempotent. */
export async function runLowStockAlerts(now: Date = new Date()): Promise<LowStockAlertResult> {
  const rows = await lowStock(200);
  return {
    job: "low-stock-alerts",
    items: rows.map((r) => ({ productId: r.productId, sku: r.sku, name: r.name, onHand: r.onHand, reorderLevel: r.reorderLevel })),
    count: rows.length,
    at: now.toISOString(),
  };
}

export interface NearExpiryAlertResult {
  job: "near-expiry-alerts";
  batches: { batchId: string; productName: string; sku: string; expiryDate: string; daysToExpiry: number; onHand: string }[];
  count: number;
  at: string;
}

/** Collect batches nearing/at expiry within the window (read-only; 03 §10). Idempotent. */
export async function runNearExpiryAlerts(withinDays = 30, now: Date = new Date()): Promise<NearExpiryAlertResult> {
  const rows = await nearExpiry({ withinDays });
  return {
    job: "near-expiry-alerts",
    batches: rows.map((b) => ({
      batchId: b.batchId,
      productName: b.productName,
      sku: b.sku,
      expiryDate: b.expiryDate,
      daysToExpiry: b.daysToExpiry,
      onHand: b.onHand,
    })),
    count: rows.length,
    at: now.toISOString(),
  };
}

// ─────────────────── Batch ↔ ProductStock reconciliation ───────────────────
export interface BatchReconResult {
  job: "batch-reconciliation";
  /** Products whose Σ(Batch.onHand) ≠ ProductStock.onHand (drift detected). */
  drift: { productId: string; productStockOnHand: string; batchSum: string; delta: string }[];
  reconciled: number;
  at: string;
}

/**
 * Detect (and optionally repair) drift between Σ(Batch.onHand) and
 * ProductStock.onHand (13 §5 TBD — batches are maintained in parallel with the
 * aggregate, and a bug or partial write could diverge them). DETECT-ONLY by default
 * (repair=false) so the owner reviews before any auto-fix; with repair=true, a
 * batched product's ProductStock.onHand is set to the batch sum inside ONE tx per
 * drifting product, audited. Idempotent: a clean product produces no drift, and a
 * re-run after repair finds nothing.
 *
 * NOTE: only products that USE batches are reconciled — a non-batched product
 * legitimately has Σ(Batch)=0 while ProductStock.onHand>0, which is NOT drift.
 */
export async function runBatchReconciliation(repair = false, now: Date = new Date()): Promise<BatchReconResult> {
  // Sum batch on-hand per product (only products that have batches).
  const batchSums = await prisma.batch.groupBy({
    by: ["productId"],
    _sum: { onHand: true },
  });

  const drift: BatchReconResult["drift"] = [];
  let reconciled = 0;

  for (const bs of batchSums) {
    const batchSum = new Decimal(bs._sum.onHand ?? 0);
    const stock = await prisma.productStock.findUnique({
      where: { productId: bs.productId },
      select: { onHand: true },
    });
    const psOnHand = new Decimal(stock?.onHand ?? 0);
    const delta = psOnHand.minus(batchSum);
    if (!delta.isZero()) {
      drift.push({
        productId: bs.productId,
        productStockOnHand: psOnHand.toFixed(3),
        batchSum: batchSum.toFixed(3),
        delta: delta.toFixed(3),
      });
      if (repair) {
        await runTx(async (tx) => {
          await tx.productStock.update({
            where: { productId: bs.productId },
            data: { onHand: new Prisma.Decimal(batchSum.toFixed(3)) },
          });
          await audit(tx, {
            actorStaffId: null,
            roleAtTime: "SYSTEM",
            permissionUsed: null,
            action: "job.batch-reconciliation",
            targetType: "Product",
            targetId: bs.productId,
            before: { productStockOnHand: psOnHand.toFixed(3) },
            after: { productStockOnHand: batchSum.toFixed(3), delta: delta.toFixed(3) },
            requestId: null,
          });
        });
        reconciled += 1;
      }
    }
  }

  return { job: "batch-reconciliation", drift, reconciled, at: now.toISOString() };
}
