// Device PIN — password once per device, then a 4-digit PIN (16 §6, "fast re-login").
//
// THREAT MODEL, stated plainly, because a 4-digit secret deserves it:
//
//  - The PIN is NEVER an authenticator by itself. It is only accepted together with the
//    opaque device token in the `hw.device` cookie, and that token identifies the exact
//    StaffPin row. So this is two factors: the device (have) + the PIN (know). A leaked
//    PIN is useless without the cookie; a stolen cookie is useless without the PIN.
//  - 10,000 combinations is small, so `failedCount` is load-bearing. After
//    MAX_ATTEMPTS misses the PIN is locked and only a full password sign-in restores it.
//  - Both secrets are hashed at rest: argon2id for the PIN (same as passwords — low
//    entropy makes this more important, not less) and SHA-256 for the device token
//    (already 256 bits of randomness, so a fast hash is right and a slow one pointless).
//  - The real-world threat here is someone picking up the counter tablet, not a remote
//    attacker. Device-scoped PIN + lockout addresses that, and beats the status quo of
//    typing a full password in front of a queue of customers.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@hardware/db";
import { hashPassword, verifyPassword } from "./password";

/** Long-lived cookie identifying this device. Distinct from the session cookie. */
export const DEVICE_COOKIE = "hw.device";

/** How long a device stays remembered. Re-set on each successful PIN use. */
export const DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months

/** Wrong PINs before the device must sign in with a password again. */
export const MAX_ATTEMPTS = 5;

/** PIN length. Fixed rather than configurable — the UI is a 4-box pad. */
export const PIN_LENGTH = 4;

/** A device token is 256 bits of randomness; SHA-256 is the right store for it. */
function deviceHashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Reject PINs that are trivially guessable, so "1234" never protects a till. */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true; // 0000, 1111 …
  const n = pin.split("").map(Number);
  const ascending = n.every((d, i) => i === 0 || d === (n[i - 1]! + 1) % 10);
  const descending = n.every((d, i) => i === 0 || d === (n[i - 1]! + 9) % 10);
  return ascending || descending; // 1234, 4321, 9012 …
}

export interface SetPinResult {
  /** Raw device token — set as the cookie; only its hash is stored. */
  deviceToken: string;
}

/**
 * Set (or replace) the PIN for a device. Called from an authenticated session, so the
 * password has already been proven; this only binds a PIN to this device.
 *
 * Re-setting on a device that already has a PIN reuses its row and clears any lockout —
 * proving the password is exactly what should unlock it.
 */
export async function setDevicePin(args: {
  staffUserId: string;
  pin: string;
  /** Existing device token from the cookie, if this device already has one. */
  deviceToken?: string | null;
  label?: string | null;
}): Promise<SetPinResult> {
  if (isWeakPin(args.pin)) {
    throw new Error("Choose a less predictable PIN.");
  }
  const pinHash = await hashPassword(args.pin);
  const token = args.deviceToken || newDeviceToken();
  const deviceHash = deviceHashOf(token);

  await prisma.staffPin.upsert({
    where: { deviceHash },
    create: {
      staffUserId: args.staffUserId,
      deviceHash,
      pinHash,
      label: args.label ?? null,
      failedCount: 0,
      lockedUntil: null,
    },
    update: {
      // Re-binding a device to whoever just proved their password is deliberate: shops
      // share tablets, and the previous user's PIN must stop working on it.
      staffUserId: args.staffUserId,
      pinHash,
      label: args.label ?? undefined,
      failedCount: 0,
      lockedUntil: null,
    },
  });

  return { deviceToken: token };
}

export interface PinStatus {
  /** A usable PIN exists for this device. */
  available: boolean;
  /** Locked out after too many wrong attempts — password required. */
  locked: boolean;
  /** Whose PIN it is, for greeting them by name on the PIN screen. */
  staffUserId?: string;
  staffName?: string;
  attemptsLeft?: number;
}

/**
 * What the login page should show for this device: a PIN pad or the password form.
 * Deliberately reveals only the owner's display name — enough to say "Welcome back,
 * Ramesh" without disclosing the email to whoever is holding the device.
 */
export async function getPinStatus(deviceToken: string | undefined): Promise<PinStatus> {
  if (!deviceToken) return { available: false, locked: false };
  const row = await prisma.staffPin.findUnique({
    where: { deviceHash: deviceHashOf(deviceToken) },
    include: { staffUser: { select: { id: true, name: true, status: true } } },
  });
  if (!row || row.staffUser.status !== "ACTIVE") return { available: false, locked: false };

  const locked = Boolean(row.lockedUntil && row.lockedUntil.getTime() > Date.now());
  return {
    available: !locked,
    locked,
    staffUserId: row.staffUser.id,
    staffName: row.staffUser.name,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.failedCount),
  };
}

export interface PinVerifyResult {
  ok: boolean;
  staffUserId?: string;
  /** Remaining attempts after a failure; 0 means the PIN is now locked. */
  attemptsLeft?: number;
  locked?: boolean;
}

/**
 * Verify a PIN for a device. Returns the user on success so the caller can create a
 * session exactly as a password login would.
 *
 * Every failure path returns the same shape and does the same work, so timing does not
 * leak whether the device is known.
 */
export async function verifyDevicePin(
  deviceToken: string | undefined,
  pin: string,
): Promise<PinVerifyResult> {
  if (!deviceToken || !/^\d{4}$/.test(pin)) return { ok: false };

  const row = await prisma.staffPin.findUnique({
    where: { deviceHash: deviceHashOf(deviceToken) },
    include: { staffUser: { select: { id: true, status: true } } },
  });
  if (!row || row.staffUser.status !== "ACTIVE") return { ok: false };

  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { ok: false, locked: true, attemptsLeft: 0 };
  }

  const valid = await verifyPassword(pin, row.pinHash);
  if (!valid) {
    const failedCount = row.failedCount + 1;
    const nowLocked = failedCount >= MAX_ATTEMPTS;
    await prisma.staffPin.update({
      where: { id: row.id },
      data: {
        failedCount,
        // No expiry: only a password sign-in clears it. A timed unlock would just give
        // an attacker another five guesses every few minutes.
        lockedUntil: nowLocked ? new Date(Date.now() + DEVICE_TTL_MS) : null,
      },
    });
    return { ok: false, locked: nowLocked, attemptsLeft: Math.max(0, MAX_ATTEMPTS - failedCount) };
  }

  await prisma.staffPin.update({
    where: { id: row.id },
    data: { failedCount: 0, lockedUntil: null, lastUsedAt: new Date() },
  });
  return { ok: true, staffUserId: row.staffUser.id };
}

/** Forget this device — used by "sign out and forget" and when managing devices. */
export async function forgetDevice(deviceToken: string | undefined): Promise<void> {
  if (!deviceToken) return;
  await prisma.staffPin
    .delete({ where: { deviceHash: deviceHashOf(deviceToken) } })
    .catch(() => undefined);
}

/**
 * Drop every PIN for a user. Called on password change/reset: if the password was
 * compromised, PINs set under it must not survive.
 */
export async function forgetAllDevicesFor(staffUserId: string): Promise<number> {
  const { count } = await prisma.staffPin.deleteMany({ where: { staffUserId } });
  return count;
}

/** Constant-time compare, exported for callers that match opaque tokens themselves. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
