import { cookies } from "next/headers";
import { cache } from "react";
import {
  getStaffSession as resolveStaffSession,
  STAFF_COOKIE,
  type Session,
} from "@hardware/auth";

// Per-request staff session resolution. React `cache()` memoises within a single
// server request so multiple `requireStaffSession()` calls in one render resolve
// permissions once (10 §5 "cached per request"). Reads the opaque `hw.staff.session`
// cookie the middleware gates on and the login action sets.
export const getStaffSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const value = store.get(STAFF_COOKIE)?.value;
  return resolveStaffSession(value);
});

/** Throw-style guard for server components/actions: returns the Session or null. */
export async function currentStaffSession(): Promise<Session | null> {
  return getStaffSession();
}
