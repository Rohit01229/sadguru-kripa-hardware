"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createCustomer,
  recordPayment,
  triggerReminder,
  upsertCustomerSchema,
  recordPaymentSchema,
  triggerReminderSchema,
  type LedgerPaymentDTO,
  type ReminderResult,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Ledger / counter-customer server actions (transport, S5). Each: resolve the staff
// session, Zod-validate via the ONE core schema, call the core service (which
// requirePermission + audit in one tx), then revalidate. Returns a flat
// { ok | error } so client forms render inline errors. UI hiding is cosmetic; the
// core guard is the gate.

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}
export interface PaymentActionState {
  ok?: boolean;
  error?: string;
  receipt?: LedgerPaymentDTO;
}
export interface ReminderActionState {
  ok?: boolean;
  error?: string;
  result?: ReminderResult;
}

function toError(e: unknown): string {
  if (e instanceof Forbidden) return "You do not have permission for this action.";
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.";
  }
  if (e instanceof DomainError) {
    switch (e.code) {
      case "NOT_FOUND":
        return "Customer not found.";
      case "IDEMPOTENCY_MISMATCH":
        return "Duplicate request with different data — refresh and retry.";
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

const rupeesToPaise = (v: FormDataEntryValue | null): number =>
  v ? Math.round(Number(v) * 100) : 0;

/** Create a counter customer (name/phone/GSTIN/type). */
export async function createCustomerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = upsertCustomerSchema.parse({
      name: form.get("name"),
      phone: form.get("phone") || null,
      gstin: form.get("gstin") || null,
      type: form.get("type") || "RETAIL",
      creditLimit: form.get("creditLimit") ? rupeesToPaise(form.get("creditLimit")) : null,
    });
    const customer = await createCustomer(input, c);
    revalidatePath("/ledger");
    return { ok: true, id: customer.id };
  } catch (e) {
    return { error: toError(e) };
  }
}

/** Record a khata receipt against a customer's outstanding (idempotent). */
export async function recordPaymentAction(
  customerId: string,
  _prev: PaymentActionState,
  form: FormData,
): Promise<PaymentActionState> {
  try {
    const c = await ctx();
    const input = recordPaymentSchema.parse({
      amount: rupeesToPaise(form.get("amount")),
      mode: form.get("mode") || "CASH",
      reference: form.get("reference") || null,
      note: form.get("note") || null,
    });
    const idempotencyKey = String(form.get("idempotencyKey") || randomUUID());
    const receipt = await recordPayment(customerId, input, { ...c, idempotencyKey });
    revalidatePath(`/ledger/${customerId}`);
    revalidatePath("/ledger");
    return { ok: true, receipt };
  } catch (e) {
    return { error: toError(e) };
  }
}

/** Trigger a dues reminder for a customer (queue stub until S7). */
export async function triggerReminderAction(
  customerId: string,
  _prev: ReminderActionState,
  form: FormData,
): Promise<ReminderActionState> {
  try {
    const c = await ctx();
    const input = triggerReminderSchema.parse({ channel: form.get("channel") || "EMAIL" });
    const result = await triggerReminder(customerId, input, c);
    return { ok: true, result };
  } catch (e) {
    return { error: toError(e) };
  }
}
