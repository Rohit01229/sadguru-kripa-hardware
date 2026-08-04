import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getPrimaryShopId } from "@hardware/core";
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

/**
 * The caller's active shop id, for tenant-scoped reads in server components (17).
 * Every core read now takes a `shopId`; a page resolves it once via this helper and
 * threads it in. Redirects to /login when there is no valid staff session/shop — the
 * (admin) layout already guards, so this is both a safety net and the shopId accessor.
 */
export async function requireShopId(): Promise<string> {
  const session = await getStaffSession();
  if (!session?.shopId) redirect("/login");
  return session.shopId;
}

/**
 * Shop id for the admin app's PUBLIC catalog endpoints (17) — the handful of `🌐`
 * routes (products/categories/price) that serve storefront-safe data with no session
 * to carry a shop. P0 resolves the single/primary shop; host-based resolution replaces
 * this when per-shop subdomains land (P4). Throws (→ handled by errorResponse) if no
 * shop is configured.
 */
export async function publicShopId(): Promise<string> {
  const id = await getPrimaryShopId();
  if (!id) throw new Error("No active shop configured");
  return id;
}
