"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  finalizeKacha,
  finalizePakka,
  convertKachaToPakka,
  cancelInvoice,
  createCreditNote,
  kachaDecrementSchema,
  finalizePakkaSchema,
  convertKachaSchema,
  cancelInvoiceSchema,
  createCreditNoteSchema,
  type KachaEstimate,
  type InvoiceDTO,
  type CreditNoteDTO,
  DomainError,
  Forbidden,
  InsufficientStock,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Billing server actions (transport, S4). Each: resolve the staff session, Zod-
// validate via the ONE core schema, call the core service (which requirePermission +
// audit in one tx), and return a typed result. Pakka/convert carry an Idempotency-
// Key so a double-submit replays the original invoice (04 §5). Kacha is NOT
// idempotent in the bill sense (no bill persisted — the client guards double-submit).

export interface KachaActionState {
  ok?: boolean;
  error?: string;
  estimate?: KachaEstimate;
}
export interface PakkaActionState {
  ok?: boolean;
  error?: string;
  invoice?: InvoiceDTO;
}

function toError(e: unknown): string {
  if (e instanceof Forbidden) return "You do not have permission for this action.";
  if (e instanceof InsufficientStock)
    return "Not enough stock — this sale would oversell. Reduce the quantity or restock.";
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.";
  }
  if (e instanceof DomainError) {
    switch (e.code) {
      case "NOT_FOUND":
        return "Product or sale unit not found.";
      case "FRACTIONAL_PIECE":
        return "This unit is piece-type — fractional quantities are not allowed.";
      case "IDEMPOTENCY_MISMATCH":
        return "Duplicate request with different data — refresh and retry.";
      case "KHATA_CUSTOMER_REQUIRED":
        return "Pick a customer to bill on khata, or choose cash/UPI/card.";
      case "ALREADY_CANCELLED":
        return "This invoice is already cancelled.";
      case "INVOICE_CANCELLED":
        return "This invoice is cancelled — corrections apply to active invoices only.";
      case "RETURN_EXCEEDS_BILLED":
        return "The return quantity exceeds what was billed on this invoice.";
      case "LINE_NOT_ON_INVOICE":
        return "That product/sale-unit is not on the original invoice.";
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

/** Finalize a kacha cart → stock decremented (KACHA_OUT only), ephemeral estimate. */
export async function finalizeKachaAction(input: unknown): Promise<KachaActionState> {
  try {
    const c = await ctx();
    const data = kachaDecrementSchema.parse(input);
    const estimate = await finalizeKacha(data, c);
    return { ok: true, estimate };
  } catch (e) {
    return { error: toError(e) };
  }
}

/** Create a pakka tax invoice. Carries a per-submit Idempotency-Key (04 §5). */
export async function finalizePakkaAction(input: unknown, idempotencyKey?: string): Promise<PakkaActionState> {
  try {
    const c = await ctx();
    const data = finalizePakkaSchema.parse(input);
    const invoice = await finalizePakka(data, { ...c, idempotencyKey: idempotencyKey ?? randomUUID() });
    return { ok: true, invoice };
  } catch (e) {
    return { error: toError(e) };
  }
}

/** Convert the in-memory kacha cart → a real pakka invoice (idempotent). */
export async function convertKachaAction(input: unknown, idempotencyKey?: string): Promise<PakkaActionState> {
  try {
    const c = await ctx();
    const data = convertKachaSchema.parse(input);
    const invoice = await convertKachaToPakka(data, { ...c, idempotencyKey: idempotencyKey ?? randomUUID() });
    return { ok: true, invoice };
  } catch (e) {
    return { error: toError(e) };
  }
}

// ─────────────────── S5 corrections: cancel + credit note ───────────────────
export interface CreditNoteActionState {
  ok?: boolean;
  error?: string;
  creditNote?: CreditNoteDTO;
}

/**
 * Cancel a pakka invoice (owner-only bill.cancel). Reason required; reverses stock +
 * ledger, sets CANCELLED (no delete — gapless preserved). Refreshes the day-book.
 */
export async function cancelInvoiceAction(
  invoiceId: string,
  _prev: PakkaActionState,
  form: FormData,
): Promise<PakkaActionState> {
  try {
    const c = await ctx();
    const input = cancelInvoiceSchema.parse({ reason: String(form.get("reason") ?? "") });
    const invoice = await cancelInvoice(invoiceId, input, c);
    revalidatePath("/billing/invoices");
    revalidatePath(`/billing/invoices/${invoiceId}`);
    revalidatePath("/stock");
    return { ok: true, invoice };
  } catch (e) {
    return { error: toError(e) };
  }
}

/**
 * Create a credit note against a pakka invoice (bill.creditnote.create). Picks lines
 * + refund mode; own gapless CN series; reverses stock via SALES_RETURN_IN.
 * Idempotent on the submit's Idempotency-Key.
 */
export async function createCreditNoteAction(
  invoiceId: string,
  _prev: CreditNoteActionState,
  form: FormData,
): Promise<CreditNoteActionState> {
  try {
    const c = await ctx();
    // Each returned line is a row: productId / saleUnitId / quantity (blank qty = skip).
    const productIds = form.getAll("productId").map(String);
    const saleUnitIds = form.getAll("saleUnitId").map(String);
    const quantities = form.getAll("quantity").map(String);
    const lines = [];
    for (let i = 0; i < productIds.length; i++) {
      if (!productIds[i] || !quantities[i] || Number(quantities[i]) <= 0) continue;
      lines.push({ productId: productIds[i]!, saleUnitId: saleUnitIds[i]!, quantity: quantities[i]! });
    }
    const input = createCreditNoteSchema.parse({
      reason: form.get("reason") || null,
      refundMode: form.get("refundMode") || "CASH",
      lines,
    });
    const idempotencyKey = String(form.get("idempotencyKey") || randomUUID());
    const creditNote = await createCreditNote(invoiceId, input, { ...c, idempotencyKey });
    revalidatePath("/billing/invoices");
    revalidatePath(`/billing/invoices/${invoiceId}`);
    revalidatePath("/stock");
    return { ok: true, creditNote };
  } catch (e) {
    return { error: toError(e) };
  }
}
