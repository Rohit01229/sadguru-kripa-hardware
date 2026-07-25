"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FormField,
  Input,
  Textarea,
  Select,
  Button,
  toast,
} from "@hardware/ui";
import { updateSettingsAction, type SettingsActionState } from "./actions";
import type { FullStoreConfigDTO } from "@hardware/core";

// StoreConfig editor (S7; settings.write). The action enforces settings.write +
// audit; this UI is shown only to permitted users (cosmetic). Money is entered in
// rupees and converted to paise in the action. On success the page refreshes.
export function SettingsForm({ config }: { config: FullStoreConfigDTO }) {
  const router = useRouter();
  const t = useTranslations("settings");
  // Pass the server action DIRECTLY to useActionState so Next emits a real
  // progressive-enhancement endpoint (<form action="" method="POST"> with the
  // $ACTION hidden fields). Wrapping it in an inline client closure would render
  // action="javascript:throw …" and drop the JS-off / pre-hydration fallback.
  const [state, formAction, pending] = useActionState(updateSettingsAction, {});

  // Surface the action result through the toast channel (§4.5) and refresh the
  // server tree on success (replaces the old inline-wrapper router.refresh()). The
  // result also stays available inline below for the error case.
  const seen = useRef<SettingsActionState | null>(null);
  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.ok) {
      toast.success(t("form.toastSaved"));
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router, t]);

  // Convert integer paise to a plain rupee string for the numeric inputs (no grouping
  // — grouping would break <input type="number">). This is an input default, not a
  // display value.
  const rupeesInput = (paise: number) => (paise / 100).toFixed(2);

  return (
    <form action={formAction} className="space-y-6">
      <fieldset className="space-y-4 rounded-lg border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">{t("form.identityLegend")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("form.shopName")} required>
            <Input name="name" defaultValue={config.name} />
          </FormField>
          <FormField label={t("form.gstin")}>
            <Input name="gstin" defaultValue={config.gstin ?? ""} placeholder={t("form.gstinPlaceholder")} />
          </FormField>
          <FormField label={t("form.homeState")} required>
            <Input name="homeState" defaultValue={config.homeState} placeholder={t("form.homeStatePlaceholder")} />
          </FormField>
          <FormField label={t("form.logoKey")}>
            <Input name="logoKey" defaultValue={config.logoKey ?? ""} placeholder={t("form.logoKeyPlaceholder")} />
          </FormField>
        </div>
        <FormField label={t("form.address")}>
          <Textarea name="address" defaultValue={config.address ?? ""} rows={2} />
        </FormField>
        <FormField label={t("form.bankDetails")}>
          <Textarea name="bankDetails" defaultValue={config.bankDetails ?? ""} rows={2} />
        </FormField>
        <FormField label={t("form.invoiceTerms")}>
          <Textarea name="invoiceTerms" defaultValue={config.invoiceTerms ?? ""} rows={2} />
        </FormField>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">{t("form.billingLegend")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("form.invoicePrefixFormat")}>
            <Input name="invoicePrefixFormat" defaultValue={config.invoicePrefixFormat} placeholder={t("form.invoicePrefixPlaceholder")} />
          </FormField>
          <FormField label={t("form.gstRounding")}>
            <Select name="gstRoundingMode" defaultValue={config.gstRoundingMode}>
              {["PER_INVOICE", "PER_LINE", "NONE"].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t("form.deliveryFlatFee")}>
            <Input name="deliveryFlatFee" defaultValue={rupeesInput(config.deliveryFlatFee)} type="number" step="0.01" />
          </FormField>
          <FormField label={t("form.freeDeliveryThreshold")}>
            <Input
              name="freeDeliveryThreshold"
              defaultValue={config.freeDeliveryThreshold == null ? "" : rupeesInput(config.freeDeliveryThreshold)}
              type="number"
              step="0.01"
            />
          </FormField>
          <FormField label={t("form.reservationTtlMinutes")}>
            <Input name="reservationTtlMinutes" defaultValue={String(config.reservationTtlMinutes)} type="number" />
          </FormField>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" isLoading={pending}>
          {t("form.save")}
        </Button>
        {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
      </div>
    </form>
  );
}
