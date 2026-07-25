"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { destroyStaffSession, STAFF_COOKIE } from "@hardware/auth";

// Logout: delete the StaffSession row (instant revoke — 07 §1) and clear the cookie.
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const value = store.get(STAFF_COOKIE)?.value;
  await destroyStaffSession(value);
  store.delete(STAFF_COOKIE);
  redirect("/login");
}
