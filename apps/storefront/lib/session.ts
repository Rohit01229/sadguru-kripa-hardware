import { cookies } from "next/headers";
import { cache } from "react";
import { getPrimaryShopId } from "@hardware/core";
import {
  getCustomerSession as resolveCustomerSession,
  CUSTOMER_COOKIE,
  type Session,
} from "@hardware/auth";

// Per-request customer session resolution (React `cache()` memoised). Reads the
// opaque `hw.customer.session` cookie; the resolved Session is ownership-scoped
// (no staff permissions — 10 §2.3).
export const getCustomerSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const value = store.get(CUSTOMER_COOKIE)?.value;
  return resolveCustomerSession(value);
});

/** Server-component/action guard: the customer Session or null (transport answers 401). */
export async function currentCustomerSession(): Promise<Session | null> {
  return getCustomerSession();
}

/**
 * The shop this storefront serves (17 — multi-tenancy). Public catalog pages have no
 * session, so tenant scope can't come from a cookie: P0 resolves the single/primary
 * shop (host/subdomain-based resolution arrives with P4). A logged-in customer's
 * session shopId equals this. Cached per request. Every storefront core read threads
 * the returned shopId. Throws if no shop is configured (a misconfiguration, not a
 * user error).
 */
export const storefrontShopId = cache(async (): Promise<string> => {
  const session = await getCustomerSession();
  if (session?.shopId) return session.shopId;
  const id = await getPrimaryShopId();
  if (!id) throw new Error("Storefront: no active shop configured");
  return id;
});
