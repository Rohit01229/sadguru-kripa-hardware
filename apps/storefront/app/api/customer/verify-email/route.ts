import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyCustomerEmail, createAuthLimiter, checkLimit, clientIp } from "@hardware/auth";

// POST /api/customer/verify-email (04 §6) — consume the single-use, hashed token
// from the verification email and mark the account verified.
//
// Rate-limited (ratelimit-1): the token is looked up by hash, so without a limiter
// an attacker could brute-force outstanding verify tokens. No account identifier
// exists pre-token, so we throttle on (a) client IP, (b) a per-token backstop keyed
// on the token's hash (so a single token can't be hammered), and (c) a low global
// ceiling that survives XFF rotation (ratelimit-4). Credential/token endpoint →
// fail-CLOSED on a limiter outage.
const schema = z.object({ token: z.string().min(1) });

const ipLimiter = createAuthLimiter("customer:verify:ip", 10, "15 m");
const tokenLimiter = createAuthLimiter("customer:verify:token", 5, "15 m");
const globalLimiter = createAuthLimiter("customer:verify:global", 200, "1 m");

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

  // Backstop keyed on the token hash (never the raw token) so XFF rotation can't
  // hammer a single guessed token; only the hash is used as the bucket id.
  const tokenKey = createHash("sha256").update(parsed.data.token).digest("hex").slice(0, 32);
  if (!(await checkLimit(tokenLimiter, `tok:${tokenKey}`, { failClosed: true })).success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const ok = await verifyCustomerEmail(parsed.data.token);
  if (!ok) return NextResponse.json({ error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
