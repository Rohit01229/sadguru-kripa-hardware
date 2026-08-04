"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateBillTheme, DomainError, Forbidden } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";

// Bill-theme server action (19 §7). Thin transport: resolve the session, hand the raw
// config to the core service — which owns the Zod parse, the settings.write guard and
// the audit — then revalidate the pages that render a bill.

export interface ThemeActionState {
  ok?: boolean;
  error?: string;
}

export async function saveBillThemeAction(theme: unknown): Promise<ThemeActionState> {
  try {
    const session = await getStaffSession();
    if (!session) return { error: "Please sign in again." };
    await updateBillTheme(theme, { session, requestId: await requestId() });

    // Every surface that prints or previews a bill.
    revalidatePath("/settings/bill-theme");
    revalidatePath("/billing");
    revalidatePath("/billing/invoices", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof Forbidden) return { error: "You do not have permission to change settings." };
    if (e instanceof z.ZodError) {
      const first = e.issues[0];
      return { error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid theme." };
    }
    if (e instanceof DomainError) return { error: e.message };
    return { error: "Could not save the theme. Please try again." };
  }
}
