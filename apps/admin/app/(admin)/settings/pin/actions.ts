"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  setDevicePin,
  forgetDevice,
  getPinStatus,
  isWeakPin,
  DEVICE_COOKIE,
  DEVICE_TTL_MS,
  sessionCookieOptions,
} from "@hardware/auth";
import { getStaffSession } from "../../../../lib/session";

// Setting a device PIN happens from an AUTHENTICATED session — the password has already
// been proven, so this only binds a short PIN to this device. That ordering is what makes
// a 4-digit secret acceptable: it can never be used to gain access on its own.

export interface PinState {
  ok?: boolean;
  error?: string;
}

export async function setPinAction(pin: string, label?: string): Promise<PinState> {
  const session = await getStaffSession();
  if (!session) return { error: "Please sign in again." };

  if (!/^\d{4}$/.test(pin)) return { error: "Enter a 4-digit PIN." };
  if (isWeakPin(pin)) {
    return { error: "Avoid PINs like 1234 or 0000 — pick something less predictable." };
  }

  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value;
  const { deviceToken } = await setDevicePin({
    staffUserId: session.userId,
    pin,
    deviceToken: existing,
    label: label?.trim() || null,
  });

  // Long-lived and httpOnly: this is half of the two factors, so JavaScript must not be
  // able to read it, and it should outlive the session it was created in.
  store.set(DEVICE_COOKIE, deviceToken, {
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
    expires: new Date(Date.now() + DEVICE_TTL_MS),
  });

  revalidatePath("/settings/pin");
  return { ok: true };
}

export async function removePinAction(): Promise<PinState> {
  const session = await getStaffSession();
  if (!session) return { error: "Please sign in again." };
  const store = await cookies();
  await forgetDevice(store.get(DEVICE_COOKIE)?.value);
  store.delete(DEVICE_COOKIE);
  revalidatePath("/settings/pin");
  return { ok: true };
}

/** Whether THIS device already has a PIN, for the settings screen. */
export async function currentDevicePinStatus(): Promise<{ hasPin: boolean; name?: string }> {
  const store = await cookies();
  const status = await getPinStatus(store.get(DEVICE_COOKIE)?.value);
  return { hasPin: status.available || status.locked, name: status.staffName };
}
