"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  loginPlatform,
  hashPassword,
  createPlatformSession,
  destroyPlatformSession,
  sessionCookieOptions,
  PLATFORM_COOKIE,
} from "@hardware/auth";
import {
  provisionShop,
  setShopStatus,
  assignPlan,
  recordSubscriptionPayment,
  cancelSubscription,
  DomainError,
} from "@hardware/core";
import { requirePlatformSession, requireSuperAdmin } from "../../lib/platform-session";
import { requestId } from "../../lib/logger";

// Platform (super-admin) server actions — 16 §4a.
//
// The platform realm has its OWN cookie and session table, so nothing here can be
// satisfied by a shop login. Every mutation re-checks the realm server-side; the UI
// hiding a button is cosmetic.

export interface PlatformState {
  ok?: boolean;
  error?: string;
}

// ── Auth ──

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

export async function platformLoginAction(_prev: PlatformState, form: FormData): Promise<PlatformState> {
  const parsed = loginSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const result = await loginPlatform(parsed.data.email, parsed.data.password);
  // Deliberately identical message for unknown email and wrong password — telling an
  // attacker which super-admin emails exist is a gift.
  if (!result.ok || !result.userId) return { error: "Email or password is incorrect." };

  const cookie = await createPlatformSession(result.userId);
  const store = await cookies();
  store.set(cookie.name, cookie.value, {
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
    expires: cookie.expires,
  });
  redirect("/platform");
}

export async function platformLogoutAction(): Promise<void> {
  const store = await cookies();
  await destroyPlatformSession(store.get(PLATFORM_COOKIE)?.value);
  store.delete(PLATFORM_COOKIE);
  redirect("/platform/login");
}

// ── Shops ──

const provisionSchema = z.object({
  name: z.string().trim().min(2, "Enter the shop's name.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Enter a short address for the shop.")
    .max(40)
    // Slug becomes a subdomain later (P4), so keep it URL- and DNS-safe from day one.
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use lowercase letters, numbers and hyphens only."),
  homeState: z.string().trim().regex(/^\d{1,2}$/, "Choose the shop's state."),
  gstin: z.string().trim().optional(),
  ownerName: z.string().trim().min(2, "Enter the owner's name.").max(120),
  ownerEmail: z.string().trim().email("Enter a valid owner email."),
  ownerPassword: z.string().min(8, "Password must be at least 8 characters."),
});

export interface ProvisionState extends PlatformState {
  /** Shown once after success so the operator can pass the credentials on. */
  created?: { shopName: string; slug: string; ownerEmail: string };
}

export async function provisionShopAction(
  _prev: ProvisionState,
  form: FormData,
): Promise<ProvisionState> {
  try {
    const session = await requireSuperAdmin();
    const parsed = provisionSchema.safeParse({
      name: form.get("name"),
      slug: form.get("slug"),
      homeState: form.get("homeState"),
      gstin: form.get("gstin") || undefined,
      ownerName: form.get("ownerName"),
      ownerEmail: form.get("ownerEmail"),
      ownerPassword: form.get("ownerPassword"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check the details." };
    }
    const d = parsed.data;

    // Hash here, not in core: core must not depend on @hardware/auth (it would be a
    // cycle), and this keeps the plaintext from crossing the service boundary.
    const passwordHash = await hashPassword(d.ownerPassword);

    const shop = await provisionShop(
      {
        name: d.name,
        slug: d.slug,
        homeState: d.homeState,
        gstin: d.gstin ?? null,
        owner: { name: d.ownerName, email: d.ownerEmail, passwordHash },
      },
      { platformUserId: session.id, requestId: await requestId() },
    );

    revalidatePath("/platform");
    return {
      ok: true,
      created: { shopName: d.name, slug: shop.slug, ownerEmail: shop.ownerEmail },
    };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    if (e instanceof Error && e.message.includes("super-admin")) return { error: e.message };
    return { error: "Could not create the shop. Please try again." };
  }
}

export async function setShopStatusAction(
  shopId: string,
  status: "ACTIVE" | "SUSPENDED",
): Promise<PlatformState> {
  try {
    const session = await requireSuperAdmin();
    await setShopStatus(shopId, status, {
      platformUserId: session.id,
      requestId: await requestId(),
    });
    revalidatePath("/platform");
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    if (e instanceof Error && e.message.includes("super-admin")) return { error: e.message };
    return { error: "Could not update the shop." };
  }
}

/** Keeps the session guard reachable from client components that need the role. */
export async function currentPlatformRole(): Promise<string | null> {
  const s = await requirePlatformSession();
  return s.role;
}

// ── Subscriptions (16 §8 P4) ──
// No payment gateway: the operator collects on UPI/bank transfer and records it here.
// See doc 16 — wiring a gateway is a merchant-onboarding decision, not a code one.

export async function assignPlanAction(
  shopId: string,
  planKey: string,
  trialDays: number,
): Promise<PlatformState> {
  try {
    const session = await requireSuperAdmin();
    await assignPlan(
      { shopId, planKey, trialDays },
      { platformUserId: session.id, requestId: await requestId() },
    );
    revalidatePath("/platform");
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    return { error: "Could not change the plan." };
  }
}

export async function recordPaymentAction(
  shopId: string,
  amountRupees: string,
  method: string,
  months: number,
  reference?: string,
): Promise<PlatformState> {
  try {
    const session = await requireSuperAdmin();
    const paise = Math.round(Number(amountRupees) * 100);
    if (!Number.isFinite(paise) || paise <= 0) return { error: "Enter a valid amount." };
    await recordSubscriptionPayment(
      { shopId, amountPaise: paise, method, months, reference: reference || null },
      { platformUserId: session.id, requestId: await requestId() },
    );
    revalidatePath("/platform");
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    return { error: "Could not record the payment." };
  }
}

export async function cancelSubscriptionAction(shopId: string): Promise<PlatformState> {
  try {
    const session = await requireSuperAdmin();
    await cancelSubscription(shopId, { platformUserId: session.id, requestId: await requestId() });
    revalidatePath("/platform");
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    return { error: "Could not cancel the subscription." };
  }
}
