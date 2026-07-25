"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { destroyCustomerSession, CUSTOMER_COOKIE } from "@hardware/auth";

// Storefront customer logout (server action). Mirrors the admin logoutAction: delete
// the CustomerSession row (instant server-side revoke — 07 §1) and clear the
// `hw.customer.session` cookie, then redirect to /account. Safe to call when already
// signed out (no session row / no cookie → both are no-ops). Posted from a <form> on
// the Account page and the Header account menu (the JSON POST /api/customer/logout
// route stays for programmatic callers).
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const value = store.get(CUSTOMER_COOKIE)?.value;
  await destroyCustomerSession(value);
  store.delete(CUSTOMER_COOKIE);
  redirect("/account");
}
