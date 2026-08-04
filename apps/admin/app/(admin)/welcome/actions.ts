"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  updateStoreConfig,
  createProduct,
  createProductSchema,
  completeOnboarding,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// First-run wizard actions (16 §6). Thin transport — each step calls the SAME guarded
// core service the normal screens use, so nothing here is a special "setup mode" path
// that could drift from the real one.

export interface WizardState {
  ok?: boolean;
  error?: string;
}

function toState(e: unknown): WizardState {
  if (e instanceof Forbidden) return { error: "You do not have permission for this." };
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return { error: first ? first.message : "Please check the details." };
  }
  if (e instanceof DomainError) return { error: e.message };
  return { error: "Something went wrong. Please try again." };
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

const detailsSchema = z.object({
  name: z.string().trim().min(2, "Enter your shop's name."),
  homeState: z.string().trim().regex(/^\d{1,2}$/, "Choose your state."),
  gstin: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

/** Step 1 — confirm the shop's own details. */
export async function saveShopDetailsAction(_prev: WizardState, form: FormData): Promise<WizardState> {
  try {
    const d = detailsSchema.parse({
      name: form.get("name"),
      homeState: form.get("homeState"),
      gstin: form.get("gstin") || undefined,
      phone: form.get("phone") || undefined,
      address: form.get("address") || undefined,
    });
    await updateStoreConfig(
      {
        name: d.name,
        homeState: d.homeState,
        gstin: d.gstin ?? null,
        phone: d.phone ?? null,
        address: d.address ?? null,
      },
      await ctx(),
    );
    revalidatePath("/welcome");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/**
 * Step 2 — add one item. Name + selling price only, exactly like the quick-add form:
 * the server fills in item code, unit and category. The wizard calls this repeatedly
 * rather than batching, so a mistake on the third item does not lose the first two.
 */
export async function addFirstItemAction(name: string, price: string): Promise<WizardState> {
  try {
    const paise = Math.round(Number(price) * 100);
    if (!name.trim()) return { error: "Enter an item name." };
    if (!Number.isFinite(paise) || paise < 0) return { error: "Enter a valid price." };
    const input = createProductSchema.parse({ name: name.trim(), salePrice: paise, gstRatePct: "18" });
    await createProduct(input, await ctx());
    revalidatePath("/welcome");
    revalidatePath("/catalog");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

/** Finish (or skip) the wizard — either way it stops appearing. */
export async function finishOnboardingAction(skipped = false): Promise<WizardState> {
  try {
    await completeOnboarding(await ctx(), { skipped });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}
