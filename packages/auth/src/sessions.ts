// Opaque server-side sessions (07 §1, 10 §2.3). Auth.js v5's Credentials provider
// cannot use the database-session strategy (Credentials forces a JWT), and our
// schema ships bespoke StaffSession / CustomerSession tables, so we own the
// session mechanism directly: an opaque random id in an HttpOnly cookie maps to a
// row we can revoke instantly by deleting it. Two realms, two cookie names, never
// crossed — a customer session can never satisfy a staff lookup and vice-versa.
import { randomBytes } from "node:crypto";
import { prisma } from "@hardware/db";

export const STAFF_COOKIE = "hw.staff.session";
export const CUSTOMER_COOKIE = "hw.customer.session";
/** Platform (super-admin) realm — 16 §5e. A third, deliberately separate cookie. */
export const PLATFORM_COOKIE = "hw.platform.session";

// 30-day max lifetime (07 §1 "sliding expiry, 30-day max").
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function newOpaqueId(): string {
  return randomBytes(32).toString("base64url");
}

export interface CookieToSet {
  name: string;
  value: string;
  expires: Date;
}

/** Cookie attributes shared by both realms. `secure` is off in dev (http://localhost). */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
}

// ───────────────────────── STAFF ─────────────────────────

/** Create a StaffSession row and return the opaque cookie value + expiry. */
export async function createStaffSession(staffUserId: string): Promise<CookieToSet> {
  const id = newOpaqueId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.staffSession.create({ data: { id, staffUserId, expiresAt } });
  return { name: STAFF_COOKIE, value: id, expires: expiresAt };
}

/** Resolve a staff session cookie to its userId, or null if missing/expired. */
export async function readStaffSession(cookieValue: string | undefined): Promise<string | null> {
  if (!cookieValue) return null;
  const row = await prisma.staffSession.findUnique({ where: { id: cookieValue } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.staffSession.delete({ where: { id: cookieValue } }).catch(() => undefined);
    return null;
  }
  return row.staffUserId;
}

/** Revoke (delete) a staff session row — instant logout. */
export async function destroyStaffSession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  await prisma.staffSession.delete({ where: { id: cookieValue } }).catch(() => undefined);
}

// ──────────────────────── CUSTOMER ────────────────────────

export async function createCustomerSession(accountId: string): Promise<CookieToSet> {
  const id = newOpaqueId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.customerSession.create({ data: { id, accountId, expiresAt } });
  return { name: CUSTOMER_COOKIE, value: id, expires: expiresAt };
}

export async function readCustomerSession(cookieValue: string | undefined): Promise<string | null> {
  if (!cookieValue) return null;
  const row = await prisma.customerSession.findUnique({ where: { id: cookieValue } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.customerSession.delete({ where: { id: cookieValue } }).catch(() => undefined);
    return null;
  }
  return row.accountId;
}

export async function destroyCustomerSession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  await prisma.customerSession.delete({ where: { id: cookieValue } }).catch(() => undefined);
}

// ──────────────────────── PLATFORM (super-admin) ────────────────────────
// Same opaque-row mechanism as the other two realms, on its own table and cookie.
// Shorter TTL than a shop session: this account can create and suspend tenants, so a
// forgotten browser is a bigger problem than for a cashier.

const PLATFORM_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function createPlatformSession(platformUserId: string): Promise<CookieToSet> {
  const id = newOpaqueId();
  const expiresAt = new Date(Date.now() + PLATFORM_SESSION_TTL_MS);
  await prisma.platformSession.create({ data: { id, platformUserId, expiresAt } });
  return { name: PLATFORM_COOKIE, value: id, expires: expiresAt };
}

export async function readPlatformSession(cookieValue: string | undefined): Promise<string | null> {
  if (!cookieValue) return null;
  const row = await prisma.platformSession.findUnique({ where: { id: cookieValue } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.platformSession.delete({ where: { id: cookieValue } }).catch(() => undefined);
    return null;
  }
  return row.platformUserId;
}

export async function destroyPlatformSession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  await prisma.platformSession.delete({ where: { id: cookieValue } }).catch(() => undefined);
}
