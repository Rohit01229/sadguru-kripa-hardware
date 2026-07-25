import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  requestPasswordReset,
  createAuthLimiter,
  checkLimit,
  clientIp,
} from "@hardware/auth";
import { serverLogger } from "../../../../../lib/logger";

// POST /api/customer/password/reset-request (04 §6) — rate-limited, ENUMERATION-
// SAFE: always returns the same 200 whether or not the account exists. When it
// does, a single-use hashed reset token is issued (older unused ones invalidated).
const schema = z.object({ email: z.string().email() });

const limiter = createAuthLimiter("customer:reset:ip", 5, "15 m");
// Per-account backstop (ratelimit-4): the per-IP limiter is bypassable by rotating
// the X-Forwarded-For header, so also cap reset requests per target email.
const acctLimiter = createAuthLimiter("customer:reset:acct", 10, "15 m");

export async function POST(req: NextRequest): Promise<NextResponse> {
  const log = await serverLogger();
  const ip = clientIp((n) => req.headers.get(n));
  const check = await checkLimit(limiter, `ip:${ip}`);
  if (!check.success) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.issues }, { status: 400 });
  }

  if (!(await checkLimit(acctLimiter, `acct:${parsed.data.email.toLowerCase()}`)).success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const issued = await requestPasswordReset("CUSTOMER", parsed.data.email);
  if (issued) {
    // TODO(S6): email the reset link via Resend. Log a redacted preview for dev.
    log.info("password reset token issued", { resetTokenPreview: issued.token.slice(0, 6) + "…" });
  }

  // Same response regardless (07 §1).
  return NextResponse.json({ ok: true, message: "If an account exists, we've emailed a reset link." });
}
