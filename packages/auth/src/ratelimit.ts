import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Per-IP / per-account throttling for login, reset, verify (07 §1, 06).
// Reads UPSTASH_REDIS_REST_URL / _TOKEN from env at runtime.
//
// Degrades gracefully when Upstash env is absent (dev): `createAuthLimiter`
// returns null and `checkLimit` treats a null limiter as "allowed" — the code
// compiles and runs without Redis, and rate-limiting switches on automatically
// once the env vars are present in prod (14-impl-plan Chunk 5 step 2).

let cachedRedis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

/**
 * Build a sliding-window limiter, or null if Upstash is not configured.
 * @param limit  max requests per window (default 5)
 * @param window Upstash duration string (default "15 m")
 *
 * Fail-open is intended only for dev (no Upstash env). In PRODUCTION a null
 * limiter means brute-force protection is silently OFF — a misconfiguration —
 * so we emit a loud `console.error` (captured by the apps' Sentry init) to
 * surface it. We still return null (rather than throwing) so a transient/partial
 * env problem can't take the whole app down at import time; the alert is the
 * signal to fix the env.
 */
export function createAuthLimiter(
  prefix: string,
  limit = 5,
  window: Parameters<typeof Ratelimit.slidingWindow>[1] = "15 m",
): Ratelimit | null {
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      // Surfaced via Sentry (console.error is captured by the apps' instrumentation).
      console.error(
        JSON.stringify({
          level: "error",
          msg: "auth rate limiter is DISABLED in production — UPSTASH_REDIS_REST_URL/_TOKEN missing; brute-force protection is OFF",
          prefix,
          time: new Date().toISOString(),
        }),
      );
    }
    return null;
  }
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `rl:${prefix}`,
  });
}

export interface LimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

/**
 * Check a limiter for an identifier. A null limiter (no Upstash in dev) is
 * fail-open: returns success. Identifiers should be per-IP or per-account
 * (e.g. `ip:1.2.3.4` or `acct:owner@x`).
 *
 * Upstash OUTAGE handling: `limiter.limit()` can throw if Redis is unreachable.
 * Previously that threw uncaught and surfaced as an opaque 500 / rejected server
 * action. We now catch it. By default we fail-OPEN on an outage (availability >
 * a brief throttling gap during a Redis incident), but credential/token
 * endpoints can pass `{ failClosed: true }` to instead deny (clean 429) so a
 * Redis incident can't be used to remove brute-force protection.
 */
export async function checkLimit(
  limiter: Ratelimit | null,
  identifier: string,
  opts?: { failClosed?: boolean },
): Promise<LimitResult> {
  if (!limiter) return { success: true, remaining: -1, reset: 0 };
  try {
    const r = await limiter.limit(identifier);
    return { success: r.success, remaining: r.remaining, reset: r.reset };
  } catch (err) {
    // Controlled decision instead of an unhandled throw (→ opaque 500).
    console.error(
      JSON.stringify({
        level: "error",
        msg: "rate limiter check failed (Upstash error)",
        failClosed: opts?.failClosed ?? false,
        err: String(err),
        time: new Date().toISOString(),
      }),
    );
    return { success: !opts?.failClosed, remaining: -1, reset: 0 };
  }
}

/**
 * Extract the client IP from request headers WITHOUT trusting the spoofable
 * leftmost X-Forwarded-For token (gap: ratelimit-4).
 *
 * Behind a single trusted proxy (Vercel), the platform appends the real client
 * IP as the RIGHTMOST XFF entry — anything to its left is client-supplied and
 * forgeable. We therefore prefer, in order:
 *   1. x-vercel-forwarded-for / x-real-ip (set by the trusted proxy; not
 *      client-spoofable through Vercel's edge),
 *   2. the LAST hop of x-forwarded-for (the entry the trusted proxy appended),
 *   3. "unknown".
 *
 * `getHeader` is a (name) => string | null | undefined accessor so this works
 * with both Web `Headers` (req.headers.get) and Next `headers()`.
 */
export function clientIp(getHeader: (name: string) => string | null | undefined): string {
  const vercel = getHeader("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = getHeader("x-real-ip")?.trim();
  if (real) return real;
  const xff = getHeader("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    // Rightmost hop = appended by the trusted proxy; not client-controlled.
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return "unknown";
}
