import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  loginCustomer,
  createCustomerSession,
  sessionCookieOptions,
  createAuthLimiter,
  checkLimit,
  clientIp,
} from "@hardware/auth";

// POST /api/customer/login — credentials sign-in for the storefront realm.
// Zod + rate-limit (per-IP and per-account), verify argon2id (requires a verified
// email), then mint the opaque CustomerSession and set the `hw.customer.session`
// cookie. Generic error on failure (no enumeration).
const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

const ipLimiter = createAuthLimiter("customer:login:ip", 5, "15 m");
const acctLimiter = createAuthLimiter("customer:login:acct", 10, "15 m");

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp((n) => req.headers.get(n));
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.issues }, { status: 400 });
  }
  const { email, password } = parsed.data;

  if (!(await checkLimit(ipLimiter, `ip:${ip}`, { failClosed: true })).success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  if (!(await checkLimit(acctLimiter, `acct:${email.toLowerCase()}`, { failClosed: true })).success) {
    return NextResponse.json({ error: "ACCOUNT_LOCKED" }, { status: 429 });
  }

  const result = await loginCustomer(email, password);
  if (!result.ok || !result.userId) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const cookie = await createCustomerSession(result.userId);
  const store = await cookies();
  store.set(cookie.name, cookie.value, {
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
    expires: cookie.expires,
  });

  return NextResponse.json({ ok: true });
}
