"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  saveEwayBillDraft,
  recordEwayBillNumber,
  cancelEwayBill,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";

// e-Way bill server actions (doc 20 §7). Thin transport: resolve the session, hand the
// raw input to the core service — which owns validation, the permission guard and the
// audit — then revalidate the invoice page.

export interface EwayActionState {
  ok?: boolean;
  error?: string;
}

function toState(e: unknown): EwayActionState {
  if (e instanceof Forbidden) return { error: "You do not have permission for this action." };
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return { error: first ? `${first.path.join(".")}: ${first.message}` : "Please check the details." };
  }
  if (e instanceof DomainError) return { error: e.message };
  return { error: "Something went wrong. Please try again." };
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

export async function saveEwayDraftAction(invoiceId: string, input: unknown): Promise<EwayActionState> {
  try {
    await saveEwayBillDraft(invoiceId, input as never, await ctx());
    revalidatePath(`/billing/invoices/${invoiceId}`);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function recordEwayNumberAction(
  invoiceId: string,
  ewbNo: string,
  ewbDate?: string,
): Promise<EwayActionState> {
  try {
    // The schema coerces, but the input type wants a Date — parse at the boundary.
    await recordEwayBillNumber(
      invoiceId,
      { ewbNo, ewbDate: ewbDate ? new Date(ewbDate) : undefined },
      await ctx(),
    );
    revalidatePath(`/billing/invoices/${invoiceId}`);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function cancelEwayAction(
  invoiceId: string,
  reason: string,
  remark?: string,
): Promise<EwayActionState> {
  try {
    await cancelEwayBill(invoiceId, { reason: reason as never, remark }, await ctx());
    revalidatePath(`/billing/invoices/${invoiceId}`);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}
