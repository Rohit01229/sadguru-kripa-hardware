// Staff (admin) realm — credentials + opaque DB-session wiring (07 §1, 10 §2.3).
//
// Design note: Auth.js v5's Credentials provider is JWT-only — it cannot drive
// the *database* session strategy this project requires (opaque cookie → a
// revocable StaffSession row). Rather than fight that, the realm's authoritative
// session is the opaque server-side session in ../sessions.ts: login verifies
// argon2id (../flows loginStaff), mints a StaffSession, and sets the
// `hw.staff.session` cookie the middleware gates on. This module exposes the
// realm's credential check and cookie name so the admin app's login action and
// the (optional) Auth.js handler share ONE implementation.
import { loginStaff } from "../flows";
import { STAFF_COOKIE } from "../sessions";

export const STAFF_REALM = "STAFF" as const;
export const staffSessionCookieName = STAFF_COOKIE;

/** Credentials authorize fn (argon2id via ../password). Returns userId or null. */
export async function authorizeStaff(
  email: string | undefined,
  password: string | undefined,
): Promise<{ id: string } | null> {
  const r = await loginStaff(String(email ?? ""), String(password ?? ""));
  return r.ok && r.userId ? { id: r.userId } : null;
}
