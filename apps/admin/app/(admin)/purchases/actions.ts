"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  cancelPurchaseOrder,
  applyReceiptToPurchaseOrder,
  type PurchaseOrderDTO,
  type ReceiptApplied,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Purchase-order server actions (21c). Same shape as the sales side: session → the ONE
// core Zod schema → the core service (permission + audit in its own transaction).

export interface PurchaseOrderActionState {
  ok?: boolean;
  error?: string;
  order?: PurchaseOrderDTO;
}

function toError(e: unknown): string {
  if (e instanceof Forbidden) return "You do not have permission for this action.";
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the details and try again.";
  if (e instanceof DomainError) {
    switch (e.code) {
      case "NOT_FOUND":
        return "That item, supplier or order could not be found.";
      case "FRACTIONAL_PIECE":
        return "This unit is piece-type — fractional quantities are not allowed.";
      default:
        return e.message;
    }
  }
  return "Something went wrong. Please try again.";
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

export async function createPurchaseOrderAction(input: unknown): Promise<PurchaseOrderActionState> {
  try {
    const order = await createPurchaseOrder(input as never, await ctx());
    revalidatePath("/purchases");
    return { ok: true, order };
  } catch (e) {
    return { error: toError(e) };
  }
}

export async function updatePurchaseOrderAction(input: unknown): Promise<PurchaseOrderActionState> {
  try {
    const order = await updatePurchaseOrder(input as never, await ctx());
    revalidatePath("/purchases");
    revalidatePath(`/purchases/${order.id}`);
    return { ok: true, order };
  } catch (e) {
    return { error: toError(e) };
  }
}

export async function cancelPurchaseOrderAction(
  id: string,
  reason: string,
): Promise<PurchaseOrderActionState> {
  try {
    const order = await cancelPurchaseOrder({ id, reason }, await ctx());
    revalidatePath("/purchases");
    revalidatePath(`/purchases/${id}`);
    return { ok: true, order };
  } catch (e) {
    return { error: toError(e) };
  }
}

/**
 * Credit a goods receipt against its order, once the receipt exists. Called from the
 * GRN form AFTER the stock has been booked, so a failure here never means lost stock —
 * the caller surfaces it as a warning and it can be retried from the order.
 *
 * Returns whether the order is now complete, so the form can say "3 bags still to
 * come" rather than implying the order is closed.
 */
export async function applyReceiptAction(
  purchaseOrderId: string,
  grnId: string,
): Promise<PurchaseOrderActionState & { applied?: ReceiptApplied }> {
  try {
    const applied = await applyReceiptToPurchaseOrder(purchaseOrderId, grnId, await ctx());
    revalidatePath("/purchases");
    revalidatePath(`/purchases/${purchaseOrderId}`);
    return { ok: true, applied };
  } catch (e) {
    return { error: toError(e) };
  }
}
