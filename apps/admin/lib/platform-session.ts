import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { PLATFORM_COOKIE, readPlatformSession } from "@hardware/auth";
import { resolvePlatformUser } from "@hardware/core";

// Per-request platform (super-admin) session resolution — the THIRD realm (16 §5e).
// Deliberately a separate module from lib/session.ts: mixing the two would make it easy
// to guard a platform route with a shop session by accident. Different cookie,
// different table, different helper name.

export interface PlatformSession {
  id: string;
  email: string;
  name: string;
  /** SUPER_ADMIN can create/suspend shops; SUPPORT is read-only. */
  role: string;
}

/** Resolve the platform session, or null. Memoised per request via React cache(). */
export const getPlatformSession = cache(async (): Promise<PlatformSession | null> => {
  const store = await cookies();
  const value = store.get(PLATFORM_COOKIE)?.value;
  const userId = await readPlatformSession(value);
  if (!userId) return null;
  return resolvePlatformUser(userId);
});

/** Guard for platform pages: returns the session or redirects to the platform login. */
export async function requirePlatformSession(): Promise<PlatformSession> {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return session;
}

/**
 * Guard for actions only a SUPER_ADMIN may take (creating and suspending tenants).
 * SUPPORT users can see the console but cannot change who exists.
 */
export async function requireSuperAdmin(): Promise<PlatformSession> {
  const session = await requirePlatformSession();
  if (session.role !== "SUPER_ADMIN") {
    throw new Error("This action needs a super-admin account.");
  }
  return session;
}
