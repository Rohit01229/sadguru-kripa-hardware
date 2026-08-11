"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  createSalesDoc,
  updateSalesDoc,
  cancelSalesDoc,
  markSalesDocConverted,
  SALES_DOC_META,
  type SalesDocDTO,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Server actions for the pre-sale documents (21). Same shape as the billing actions:
// resolve the session, hand the raw input to the ONE core Zod schema, let the core
// service do permission + audit in its own transaction, and map thrown errors to
// something a shopkeeper can act on.

export interface SalesDocActionState {
  ok?: boolean;
  error?: string;
  doc?: SalesDocDTO;
}

function toError(e: unknown): string {
  if (e instanceof Forbidden) return "You do not have permission for this action.";
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return first ? first.message : "Check the details and try again.";
  }
  if (e instanceof DomainError) {
    switch (e.code) {
      case "NOT_FOUND":
        return "That item or document could not be found.";
      case "FRACTIONAL_PIECE":
        return "This unit is piece-type — fractional quantities are not allowed.";
      case "SALESDOC_NOT_EDITABLE":
      case "SALESDOC_ALREADY_CONVERTED":
      case "SALESDOC_NOT_OPEN":
        return e.message;
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

/** Revalidate the list + detail surfaces a write can have changed. */
function revalidateDoc(doc: SalesDocDTO) {
  const slug = SALES_DOC_META[doc.kind].slug;
  revalidatePath(`/sales/${slug}`);
  revalidatePath(`/sales/${slug}/${doc.id}`);
}

export async function createSalesDocAction(input: unknown): Promise<SalesDocActionState> {
  try {
    const doc = await createSalesDoc(input as never, await ctx());
    revalidateDoc(doc);
    return { ok: true, doc };
  } catch (e) {
    return { error: toError(e) };
  }
}

export async function updateSalesDocAction(input: unknown): Promise<SalesDocActionState> {
  try {
    const doc = await updateSalesDoc(input as never, await ctx());
    revalidateDoc(doc);
    return { ok: true, doc };
  } catch (e) {
    return { error: toError(e) };
  }
}

export async function cancelSalesDocAction(id: string, reason: string): Promise<SalesDocActionState> {
  try {
    const doc = await cancelSalesDoc({ id, reason }, await ctx());
    revalidateDoc(doc);
    return { ok: true, doc };
  } catch (e) {
    return { error: toError(e) };
  }
}

/**
 * Stamp a document as billed. Called by the POS from the browser AFTER the invoice
 * has already been created and shown, so a failure here must never look like a failed
 * sale — the invoice is real either way. The caller surfaces this as a warning, not an
 * error, and the operator can retry from the document.
 */
export async function markConvertedAction(
  salesDocId: string,
  invoiceId: string,
): Promise<SalesDocActionState> {
  try {
    await markSalesDocConverted(salesDocId, invoiceId, await ctx());
    revalidatePath("/sales/estimates");
    revalidatePath("/sales/proforma");
    revalidatePath("/sales/challans");
    revalidatePath(`/sales/estimates/${salesDocId}`);
    revalidatePath(`/sales/proforma/${salesDocId}`);
    revalidatePath(`/sales/challans/${salesDocId}`);
    return { ok: true };
  } catch (e) {
    return { error: toError(e) };
  }
}

// Quick-add of a party or an item mid-document (19 §6) deliberately has NO action
// here: the document form calls the POS's existing quickCreateCustomerAction /
// quickCreateItemAction. One affordance, one implementation — an item quick-added on a
// quotation is byte-for-byte the same item as one quick-added at the counter.
