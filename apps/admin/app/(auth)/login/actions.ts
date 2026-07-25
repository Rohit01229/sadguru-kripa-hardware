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

// TEMPORARY (debugging the deploy): limits relaxed so repeated login attempts don't
// lock you out while we stabilise things. Tighten back to ~5 (IP) / ~10 (acct) with a
// "15 m" window before real go-live. Window shortened to 5 min so any lockout clears fast.
const ipLimiter = createAuthLimiter("staff:login:ip", 100, "5 m");
const acctLimiter = createAuthLimiter("staff:login:acct", 100, "5 m");

export interface LoginState {
  error?: string;
  /** Seconds until the lockout clears (drives the countdown on the form). */
  retryAfterSec?: number;
}

/** Seconds remaining until an Upstash `reset` timestamp (ms), clamped at 0. */
function retryAfterSec(reset: number): number {
  return Math.max(0, Math.ceil((reset - Date.now()) / 1000));
}

/** Human phrase for the lockout message (e.g. "about 3 minutes" / "45 seconds"). */
function formatWait(sec: number): string {
  if (sec >= 60) {
    const m = Math.ceil(sec / 60);
    return `about ${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${sec} second${sec === 1 ? "" : "s"}`;
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
  if (!ipCheck.success) {
    const sec = retryAfterSec(ipCheck.reset);
    return { error: `Too many attempts. Try again in ${formatWait(sec)}.`, retryAfterSec: sec };
  }
  const acctCheck = await checkLimit(acctLimiter, `acct:${email.toLowerCase()}`, { failClosed: true });
  if (!acctCheck.success) {
    const sec = retryAfterSec(acctCheck.reset);
    return { error: `Account temporarily locked. Try again in ${formatWait(sec)}.`, retryAfterSec: sec };
  }

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
