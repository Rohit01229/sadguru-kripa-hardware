"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input, Select, Label, Button, toast } from "@hardware/ui";
import { createCustomerAction, type ActionState } from "./actions";

// Create-customer form (counter party for khata). The action enforces
// customers.write + audit; this UI is only shown to permitted users (cosmetic) and
// refreshes the directory on success.
export function CustomerForm() {
  const t = useTranslations("ledger");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // Pass the server action DIRECTLY to useActionState so Next emits a real
  // progressive-enhancement endpoint instead of action="javascript:throw …".
  const [state, formAction, pending] = useActionState(createCustomerAction, {});

  // Surface the action result through the standard toast channel (§4.5) and refresh
  // the directory on success. The action's return value is unchanged.
  useEffect(() => {
    if (state.ok) {
      toast.success(t("customerForm.toastAdded"));
      formRef.current?.reset();
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router, t]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="space-y-1 sm:w-48">
        <Label htmlFor="cust-name" required>
          {t("customerForm.name")}
        </Label>
        <Input
          id="cust-name"
          name="name"
          required
          placeholder={t("customerForm.namePlaceholder")}
          className="w-full"
        />
      </div>
      <div className="space-y-1 sm:w-36">
        <Label htmlFor="cust-phone">{t("customerForm.phone")}</Label>
        <Input
          id="cust-phone"
          name="phone"
          placeholder={t("customerForm.phonePlaceholder")}
          className="w-full"
        />
      </div>
      <div className="space-y-1 sm:w-44">
        <Label htmlFor="cust-gstin">{t("customerForm.gstin")}</Label>
        <Input
          id="cust-gstin"
          name="gstin"
          placeholder={t("customerForm.gstinPlaceholder")}
          className="w-full"
        />
      </div>
      <div className="space-y-1 sm:w-36">
        <Label htmlFor="cust-type">{t("customerForm.type")}</Label>
        <Select id="cust-type" name="type" defaultValue="RETAIL" className="w-full">
          <option value="RETAIL">{t("customerForm.typeRetail")}</option>
          <option value="WHOLESALE">{t("customerForm.typeWholesale")}</option>
        </Select>
      </div>
      <Button type="submit" isLoading={pending} className="w-full sm:w-auto">
        {t("customerForm.addCustomer")}
      </Button>
      {state.error && (
        <span role="alert" className="text-sm text-destructive">
          {state.error}
        </span>
      )}
    </form>
  );
}
