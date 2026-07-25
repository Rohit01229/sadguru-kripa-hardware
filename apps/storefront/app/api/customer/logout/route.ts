import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroyCustomerSession, CUSTOMER_COOKIE } from "@hardware/auth";

// POST /api/customer/logout — sign the storefront customer out. Mirrors the admin
// logout flow: delete the CustomerSession row (instant server-side revoke) and clear
// the `hw.customer.session` cookie. Safe to call when already signed out (no session
// row / no cookie → both are no-ops).
export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  const value = store.get(CUSTOMER_COOKIE)?.value;
  await destroyCustomerSession(value);
  store.delete(CUSTOMER_COOKIE);
  return NextResponse.json({ ok: true });
}
