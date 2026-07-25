// Idempotency for stock-/money-moving creates (04 §5). The client sends an
// `Idempotency-Key` header; the service stores `(key, principalId, route,
// requestHash) → response` so a retry (double-click, network re-send) returns the
// ORIGINAL response instead of repeating the effect. First used by GRN in S3
// (stock-moving); pakka/convert/place-order/payment/CN reuse it in S4–S6.
//
// Replay semantics (04 §5):
//  - same key + same body  → return the stored response (no-op, same status).
//  - same key + DIFFERENT body → DomainError("IDEMPOTENCY_MISMATCH") → 409.
//
// Note: the stored row is committed in the SAME transaction as the mutation it
// guards (the service passes its `tx`), so a rolled-back mutation also rolls back
// its idempotency record — a failed attempt never blocks a genuine retry.
import { prisma } from "./db";
import type { Prisma, Tx } from "./db";
import { DomainError } from "./errors";

/**
 * Stable hash of a request body for replay-mismatch detection. Uses a pure-JS
 * FNV-1a hash (no `node:crypto`) so this module stays bundler-portable — it is
 * reachable transitively from @hardware/core's exported inventory service, which
 * Next transpiles, and a `node:` import there would break the webpack build. This is NOT a security primitive: it only
 * needs to be stable and to differ when the body differs (same key + different
 * body → IDEMPOTENCY_MISMATCH). The DB `@@unique(key, principal, route)` is the
 * real guard against double-effect; the hash just catches a reused key.
 */
export function hashRequest(body: unknown): string {
  return fnv1a(stableStringify(body));
}

/** 64-bit FNV-1a over a string, as a hex string. */
function fnv1a(input: string): string {
  // Two 32-bit halves to approximate 64-bit without BigInt overhead.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c & 0xff;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c >> 8) & 0xff;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Deterministic JSON: object keys sorted so {a,b} and {b,a} hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export interface IdempotencyLookup<T> {
  /** A previously-stored response to replay (idempotent hit), or null on first sight. */
  replay: { statusCode: number; response: T } | null;
}

/**
 * Look up a prior idempotent response for `(key, principalId, route)`. Returns the
 * stored response when the body matches; throws IDEMPOTENCY_MISMATCH when the key
 * was used with a different body. Read it BEFORE opening the mutation transaction;
 * if `replay` is set, short-circuit and return it.
 */
export async function findIdempotent<T>(
  key: string,
  principalId: string,
  route: string,
  requestHash: string,
): Promise<IdempotencyLookup<T>> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key_principalId_route: { key, principalId, route } },
    select: { requestHash: true, response: true, statusCode: true },
  });
  if (!existing) return { replay: null };
  if (existing.requestHash !== requestHash) {
    throw new DomainError("Idempotency key reused with a different request body", "IDEMPOTENCY_MISMATCH");
  }
  return { replay: { statusCode: existing.statusCode, response: existing.response as T } };
}

/**
 * Persist the success response for an idempotency key INSIDE the caller's
 * transaction, so it commits/rolls back with the mutation. A concurrent first
 * attempt racing on the same key trips the unique constraint (P2002) — the service
 * maps that to IDEMPOTENCY_MISMATCH/replay at its boundary.
 */
export async function storeIdempotent(
  tx: Tx,
  key: string,
  principalId: string,
  route: string,
  requestHash: string,
  response: unknown,
  statusCode = 201,
): Promise<void> {
  await tx.idempotencyKey.create({
    data: {
      key,
      principalId,
      route,
      requestHash,
      response: response as Prisma.InputJsonValue,
      statusCode,
    },
  });
}
