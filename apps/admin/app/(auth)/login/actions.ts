"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  loginStaff,
  createStaffSession,
  sessionCookieOptions,
  createAuthLimiter,
  checkLimit,
  clientIp,
} from "@hardware/auth";

// Staff login server action (transport layer): Zod-validate, rate-limit per-IP +
// per-account lockout (07 §1, 04 §6), verify argon2id (loginStaff), mint the
// opaque StaffSession + set the `hw.staff.session` cookie the middleware gates on.
// The action is the realm gate; permissions are checked later in core.

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 5 attempts / 15 min per IP, and a stricter per-account lockout (10 / 15 min).
const ipLimiter = createAuthLimiter("staff:login:ip", 5, "15 m");
const acctLimiter = createAuthLimiter("staff:login:acct", 10, "15 m");

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const { email, password } = parsed.data;

  const h = await headers();
  const ip = clientIp((n) => h.get(n));

  const ipCheck = await checkLimit(ipLimiter, `ip:${ip}`, { failClosed: true });
  if (!ipCheck.success) return { error: "Too many attempts. Try again in a few minutes." };
  const acctCheck = await checkLimit(acctLimiter, `acct:${email.toLowerCase()}`, { failClosed: true });
  if (!acctCheck.success) return { error: "Account temporarily locked. Try again later." };

  const result = await loginStaff(email, password);
  if (!result.ok || !result.userId) {
    // Generic message — never reveal whether the email exists.
    return { error: "Invalid email or password." };
  }

  const cookie = await createStaffSession(result.userId);
  const store = await cookies();
  store.set(cookie.name, cookie.value, {
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
    expires: cookie.expires,
  });

  redirect("/dashboard");
}
