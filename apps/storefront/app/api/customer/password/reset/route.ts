import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { confirmPasswordReset, createAuthLimiter, checkLimit, clientIp } from "@hardware/auth";

// POST /api/customer/password/reset (04 §6) — confirm with the single-use token +
// new password. On success all of the customer's sessions are revoked
// (logout-everywhere) inside the same transaction as the password change.
//
// Rate-limited (ratelimit-1): this is the account-takeover-grade endpoint — a
// guessed reset token lets the caller set a new password. The token is looked up
// by hash with no account identifier pre-token, so we throttle on (a) client IP,
// (b) a per-token backstop keyed on the token hash, and (c) a low global ceiling
// that survives XFF rotation (ratelimit-4). Credential/token endpoint →
// fail-CLOSED on a limiter outage.
const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const ipLimiter = createAuthLimiter("customer:reset-confirm:ip", 10, "15 m");
const tokenLimiter = createAuthLimiter("customer:reset-confirm:token", 5, "15 m");
const globalLimiter = createAuthLimiter("customer:reset-confirm:global", 200, "1 m");

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp((n) => req.headers.get(n));
  if (!(await checkLimit(ipLimiter, `ip:${ip}`, { failClosed: true })).success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  if (!(await checkLimit(globalLimiter, "global", { failClosed: true })).success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.issues }, { status: 400 });
  }

  // Backstop keyed on the token hash (never the raw token).
  const tokenKey = createHash("sha256").update(parsed.data.token).digest("hex").slice(0, 32);
  if (!(await checkLimit(tokenLimiter, `tok:${tokenKey}`, { failClosed: true })).success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const ok = await confirmPasswordReset("CUSTOMER", parsed.data.token, parsed.data.password);
  if (!ok) return NextResponse.json({ error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
