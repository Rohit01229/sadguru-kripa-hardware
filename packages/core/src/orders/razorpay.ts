// Razorpay payment + webhook primitives (03 §9, 04 Payments). PURE, framework-free,
// and bundler-portable: signature verification uses Web Crypto (`globalThis.crypto
// .subtle`), available in Node 22 and the Edge runtime alike — NO top-level
// `node:crypto` import (a `node:` import reachable from core's exported surface
// breaks the Next/webpack build; see shared/idempotency.ts for the same rule).
//
// The SIGNED webhook is the source of truth for "paid", NOT the browser redirect
// (which can be lost or forged). Every webhook is verified by HMAC-SHA256 over the
// RAW request body keyed with RAZORPAY_WEBHOOK_SECRET, then deduped on the Razorpay
// event id (markPaid → ProcessedWebhook). The verify here is the load-bearing gate;
// it is unit-tested with a dummy secret so the slice ships without live creds.

/** Hex-encode bytes (lower-case) for HMAC comparison against the X-Razorpay-Signature header. */
function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Constant-time string compare for two equal-length hex digests. A plain `===`
 * would short-circuit on the first differing byte and leak timing; this folds every
 * byte so the comparison time does not depend on WHERE the mismatch is. Returns
 * false immediately on a length mismatch (length is not secret).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Compute the lower-case hex HMAC-SHA256 of `rawBody` keyed with `secret` (Web Crypto). */
export async function hmacSha256Hex(secret: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  return toHex(sig);
}

/**
 * Verify a Razorpay webhook signature (03 §9, 07). The signature header is the
 * HMAC-SHA256 (hex) of the RAW body keyed with the webhook secret. Returns false —
 * never throws — when the secret is empty (creds not configured yet), the signature
 * is missing, or the digest mismatches, so the route can answer 400 uniformly.
 *
 * IMPORTANT: pass the EXACT raw body string Razorpay sent (await req.text()), not a
 * re-serialised object — re-serialising reorders keys and breaks the digest.
 */
export async function verifyWebhookSignature(
  secret: string | undefined | null,
  rawBody: string,
  signatureHeader: string | undefined | null,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqualHex(expected, signatureHeader.trim());
}

/** The Razorpay webhook envelope fields we consume (03 §9, 04 §8.6). */
export interface RazorpayWebhookEvent {
  /** Razorpay event id — the idempotency key (deduped on ProcessedWebhook.eventId). */
  eventId: string;
  /** e.g. "payment.captured" | "payment.failed" | "order.paid". */
  event: string;
  /** Razorpay payment id (pay_…), when present on the event. */
  paymentId: string | null;
  /** Razorpay order id (order_…) — maps back to Order.razorpayOrderId. */
  razorpayOrderId: string | null;
  /** Captured amount in paise, when present. */
  amount: number | null;
}

/**
 * Parse the verified Razorpay webhook JSON into the envelope we act on. PURE: no
 * network, no DB. Tolerant of the two shapes Razorpay sends (payment.* nests the
 * entity under payload.payment.entity; order.paid under payload.order.entity).
 * Returns null when the event id is missing (cannot dedupe → reject upstream).
 */
export function parseWebhookEvent(body: unknown): RazorpayWebhookEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const eventId = typeof b.id === "string" ? b.id : null;
  const event = typeof b.event === "string" ? b.event : "";
  if (!eventId) return null;

  const payload = (b.payload ?? {}) as Record<string, unknown>;
  const paymentEntity = ((payload.payment as Record<string, unknown>)?.entity ?? null) as
    | Record<string, unknown>
    | null;
  const orderEntity = ((payload.order as Record<string, unknown>)?.entity ?? null) as
    | Record<string, unknown>
    | null;

  const paymentId = typeof paymentEntity?.id === "string" ? paymentEntity.id : null;
  const razorpayOrderId =
    (typeof paymentEntity?.order_id === "string" ? paymentEntity.order_id : null) ??
    (typeof orderEntity?.id === "string" ? orderEntity.id : null);
  const rawAmount = paymentEntity?.amount ?? orderEntity?.amount;
  const amount = typeof rawAmount === "number" ? rawAmount : null;

  return { eventId, event, paymentId, razorpayOrderId, amount };
}
