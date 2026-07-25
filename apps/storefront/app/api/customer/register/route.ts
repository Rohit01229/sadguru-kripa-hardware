import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  registerCustomer,
  createAuthLimiter,
  checkLimit,
  clientIp,
} from "@hardware/auth";
import { serverLogger } from "../../../../lib/logger";

// POST /api/customer/register (04 §6) — storefront sign-up. Zod-validate,
// rate-limit per-IP, create the account (unverified) + issue an email-verify
// token. ENUMERATION-SAFE: a duplicate email returns the same 200 as a fresh
// signup ("check your email") and never reveals the email is taken.
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  phone: z.string().optional(),
});

const limiter = createAuthLimiter("customer:register:ip", 5, "15 m");
// Per-account backstop (ratelimit-4): a per-IP limiter alone is bypassable by
// rotating the X-Forwarded-For header, so also cap attempts per target email.
const acctLimiter = createAuthLimiter("customer:register:acct", 10, "15 m");

export async function POST(req: NextRequest): Promise<NextResponse> {
  const log = await serverLogger();
  const ip = clientIp((n) => req.headers.get(n));
  const check = await checkLimit(limiter, `ip:${ip}`);
  if (!check.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: retryAfter(check.reset) });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const acctCheck = await checkLimit(acctLimiter, `acct:${parsed.data.email.toLowerCase()}`);
  if (!acctCheck.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: retryAfter(acctCheck.reset) });
  }

  try {
    const { verifyToken } = await registerCustomer(parsed.data);
    // TODO(S6): email the verification link via Resend. For now log (redacted) so
    // dev can grab the token from the server console.
    log.info("customer registered; verification token issued", {
      email: parsed.data.email,
      verifyTokenPreview: verifyToken.slice(0, 6) + "…",
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "EMAIL_TAKEN") {
      // Enumeration-safe: same response shape as success.
      log.warn("register attempt for existing email (enumeration-safe response)");
    } else {
      log.error("register failed", { err: String(e) });
      return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, message: "If the email is new, a verification link has been sent." });
}

function retryAfter(reset: number): Record<string, string> {
  const secs = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
  return secs > 0 ? { "Retry-After": String(secs) } : {};
}
