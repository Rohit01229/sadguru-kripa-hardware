import { cookies } from "next/headers";
import { cache } from "react";
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
