"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  createPartySchema,
  createCustomer,
  createSupplier,
  setOpeningBalance,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Parties server actions (21d).
//
// "Add party" is one form over two tables: `kind` decides which core service runs.
// Nothing here re-implements customer or supplier creation — it dispatches to the
// same permission-guarded, audited services the existing screens use, so a party
// added here is identical to one added from the ledger or the suppliers page.

export interface PartyActionState {
  ok?: boolean;
  error?: string;
  party?: { id: string; kind: "CUSTOMER" | "SUPPLIER"; name: string };
}

function toError(e: unknown): string {
  if (e instanceof Forbidden) return "You do not have permission for this action.";
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the details and try again.";
  if (e instanceof DomainError) return e.message;
  return "Something went wrong. Please try again.";
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

export async function createPartyAction(input: unknown): Promise<PartyActionState> {
  try {
    const c = await ctx();
    const data = createPartySchema.parse(input);

    if (data.kind === "SUPPLIER") {
      const s = await createSupplier(
        {
          name: data.name,
          phone: data.phone ?? null,
          gstin: data.gstin ?? null,
          address: data.address ?? null,
        },
        c,
      );
      revalidatePath("/parties");
      revalidatePath("/stock/suppliers");
      return { ok: true, party: { id: s.id, kind: "SUPPLIER", name: s.name } };
    }

    const customer = await createCustomer(
      {
        name: data.name,
        phone: data.phone ?? null,
        gstin: data.gstin ?? null,
        type: data.type,
        creditLimit: null,
      },
      c,
    );

    // Opening balance is a SEPARATE, audited ledger post rather than a column on the
    // customer: what they owed before the app existed is a transaction like any other,
    // and it has to show up on the statement to be believable. The customer already
    // exists at this point, so a failure here leaves a usable party rather than
    // rolling back the whole thing — hence the message says exactly what to do next.
    if (data.openingBalance > 0) {
      try {
        await setOpeningBalance(customer.id, data.openingBalance, c);
      } catch (e) {
        revalidatePath("/parties");
        return {
          error: `${customer.name} was added, but the opening balance could not be set: ${toError(e)}`,
        };
      }
    }

    revalidatePath("/parties");
    revalidatePath("/ledger");
    return { ok: true, party: { id: customer.id, kind: "CUSTOMER", name: customer.name } };
  } catch (e) {
    return { error: toError(e) };
  }
}
