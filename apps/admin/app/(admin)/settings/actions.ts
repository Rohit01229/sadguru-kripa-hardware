"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  updateStoreConfig,
  updateStoreConfigSchema,
  DomainError,
  Forbidden,
  type FullStoreConfigDTO,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// StoreConfig server action (transport, S7; settings.write). Resolve the staff
// session, Zod-validate via the ONE core schema, call updateStoreConfig (which
// requirePermission + audit in one tx), then revalidate. Returns a flat
// { ok | error } so the client form renders inline errors. UI hiding is cosmetic;
// the core guard is the gate.

export interface SettingsActionState {
  ok?: boolean;
  error?: string;
  config?: FullStoreConfigDTO;
}

async function toError(e: unknown): Promise<string> {
  const t = await getTranslations("settings");
  if (e instanceof Forbidden) return t("errors.forbidden");
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return first ? `${first.path.join(".")}: ${first.message}` : t("errors.invalidInput");
  }
  if (e instanceof DomainError) {
    if (e.code === "NOT_FOUND") return t("errors.notInitialised");
    return e.message;
  }
  return t("errors.generic");
}

const rupeesToPaise = (v: FormDataEntryValue | null): number =>
  v && String(v).trim() !== "" ? Math.round(Number(v) * 100) : 0;

/** Update the store config (owner-only). Empty optional fields clear to null. */
export async function updateSettingsAction(
  _prev: SettingsActionState,
  form: FormData,
): Promise<SettingsActionState> {
  try {
    const session = await getStaffSession();
    if (!session) throw new Forbidden("authenticated");

    const str = (k: string): string | undefined => {
      const v = form.get(k);
      return v == null ? undefined : String(v);
    };
    const nullableStr = (k: string): string | null | undefined => {
      const v = form.get(k);
      if (v == null) return undefined;
      const s = String(v).trim();
      return s === "" ? null : s;
    };

    const thresholdRaw = form.get("freeDeliveryThreshold");
    const input = updateStoreConfigSchema.parse({
      name: str("name"),
      gstin: nullableStr("gstin"),
      homeState: str("homeState"),
      address: nullableStr("address"),
      bankDetails: nullableStr("bankDetails"),
      invoiceTerms: nullableStr("invoiceTerms"),
      logoKey: nullableStr("logoKey"),
      invoicePrefixFormat: str("invoicePrefixFormat"),
      deliveryFlatFee: rupeesToPaise(form.get("deliveryFlatFee")),
      freeDeliveryThreshold:
        thresholdRaw == null || String(thresholdRaw).trim() === "" ? null : rupeesToPaise(thresholdRaw),
      reservationTtlMinutes: form.get("reservationTtlMinutes")
        ? Number(form.get("reservationTtlMinutes"))
        : undefined,
      gstRoundingMode: str("gstRoundingMode"),
    });

    const config = await updateStoreConfig(input, { session, requestId: await requestId() });
    revalidatePath("/settings");
    return { ok: true, config };
  } catch (e) {
    return { error: await toError(e) };
  }
}
