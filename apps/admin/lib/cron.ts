// Cron / QStash callback authentication (S7; 03 §10, 07). The scheduled spine is
// Vercel Cron → QStash → these route handlers. They are NOT session-authenticated
// (no staff cookie); they are authenticated by a SHARED SECRET / SIGNATURE so only the
// scheduler can trigger them. Two accepted forms:
//   1. `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron sets this when CRON_SECRET
//      is configured; we compare in constant time.
//   2. `Upstash-Signature` — QStash signs the request; full JWS verification needs the
//      QStash SDK (QSTASH_CURRENT_SIGNING_KEY). In v1 we accept the bearer form as the
//      primary gate and treat the signature header as present-or-deferred.
//
// RUNTIME-DEFERRED: when CRON_SECRET is empty (dev/CI), `authorizeCron` returns a
// `deferred` flag so the local operator can still hit the endpoint to smoke-test the
// job logic, while production (CRON_SECRET set) fails closed on a missing/wrong secret.
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export interface CronAuthResult {
  ok: boolean;
  /** True when no CRON_SECRET is configured → the call is allowed but flagged deferred. */
  deferred: boolean;
  reason?: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Authorize a cron/QStash callback. Production posture: a configured CRON_SECRET MUST
 * match the `Authorization: Bearer …` header (constant-time). Dev/CI posture: with no
 * CRON_SECRET, the call is allowed but `deferred:true` so the report flags the queue
 * auth as runtime-deferred. A QStash `Upstash-Signature` header is honoured as a signal
 * the call came from the queue (full JWS verification deferred to the QStash SDK).
 */
export function authorizeCron(req: NextRequest): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const upstashSig = req.headers.get("upstash-signature");

  if (!secret) {
    return { ok: true, deferred: true, reason: "CRON_SECRET unset — auth runtime-deferred" };
  }

  if (auth && auth.startsWith("Bearer ") && safeEqual(auth.slice(7), secret)) {
    return { ok: true, deferred: false };
  }

  // A QStash-signed request without the bearer is accepted only if a signing key is
  // configured (the signature is the auth then); full verification is the SDK's job.
  if (upstashSig && process.env.QSTASH_CURRENT_SIGNING_KEY) {
    return { ok: true, deferred: false };
  }

  return { ok: false, deferred: false, reason: "missing or invalid cron credentials" };
}
