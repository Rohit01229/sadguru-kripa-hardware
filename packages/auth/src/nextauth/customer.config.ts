// Customer (storefront) realm — credentials + opaque DB-session wiring.
// Separate user table + cookie from staff (10 §2.3): a customer session can never
// reach admin. Same design as staff.config.ts — the authoritative session is the
// opaque CustomerSession row (../sessions.ts), not a JWT — because Auth.js
// Credentials cannot use the database session strategy. Login requires a verified
// email (07 §1).
import { loginCustomer } from "../flows";
import { CUSTOMER_COOKIE } from "../sessions";

export const CUSTOMER_REALM = "CUSTOMER" as const;
export const customerSessionCookieName = CUSTOMER_COOKIE;

/** Credentials authorize fn for the customer realm. Returns accountId or null. */
export async function authorizeCustomer(
  email: string | undefined,
  password: string | undefined,
): Promise<{ id: string } | null> {
  const r = await loginCustomer(String(email ?? ""), String(password ?? ""));
  return r.ok && r.userId ? { id: r.userId } : null;
}
