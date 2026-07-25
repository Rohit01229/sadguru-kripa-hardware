// Audit writer (10 §7). Every sensitive / financial mutation writes one AuditLog
// row INSIDE the same transaction as the mutation it records — pass the `tx`
// handle the service is already running in, never the top-level client. The log
// is append-only (no edit/delete), matching the "no deletes" stance (10 §7).
import type { Tx } from "./db";

export interface AuditInput {
  /** Staff user who performed the action (null for unattributed acts, e.g. kacha stock-out — 10 §7). */
  actorStaffId?: string | null;
  /** Role key in effect at the time (e.g. "OWNER"), for after-the-fact review. */
  roleAtTime?: string | null;
  /** Permission key that authorised the action (e.g. "bill.pakka.create"). */
  permissionUsed?: string | null;
  /** What happened, namespaced like the permission keys (e.g. "bill.pakka.create"). */
  action: string;
  /** Entity type touched (e.g. "Invoice", "Product"). */
  targetType?: string | null;
  /** Id of the touched entity. */
  targetId?: string | null;
  /** Snapshot before the change (redact PII at the call site if needed). */
  before?: unknown;
  /** Snapshot after the change. */
  after?: unknown;
  /** Correlation id propagated from the request (transport sets it). */
  requestId?: string | null;
}

/**
 * Insert an audit row inside the caller's transaction. Returns the created row id.
 * Must be awaited within the same `prisma.$transaction(...)` as the audited write
 * so the audit trail and the mutation commit or roll back together.
 */
export async function audit(tx: Tx, input: AuditInput): Promise<string> {
  const row = await tx.auditLog.create({
    data: {
      actorStaffId: input.actorStaffId ?? null,
      roleAtTime: input.roleAtTime ?? null,
      permissionUsed: input.permissionUsed ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      // Prisma Json columns reject `undefined`; normalise to Prisma's JsonNull sentinel.
      before: toJson(input.before),
      after: toJson(input.after),
      requestId: input.requestId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

import { Prisma } from "./db";

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}
