"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  FormField,
  Input,
  Button,
  toast,
} from "@hardware/ui";
import { createSupplierAction, type ActionState } from "../actions";

// Create-supplier form. The action enforces suppliers.write + audit; this UI is
// only shown to permitted users (cosmetic) and refreshes the list on success.
export function SupplierForm() {
  const router = useRouter();
  const t = useTranslations("stock");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await createSupplierAction(prev, fd);
    if (result.ok) router.refresh();
    return result;
  }, {});

  // Surface the action result through the toast channel (§4.5). Errors also stay
  // inline near the submit button. Reset the form after a successful create.
  useEffect(() => {
    if (state.ok) {
      toast.success(t("suppliers.toastSupplierAdded"));
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("suppliers.formTitle")}</CardTitle>
        <CardDescription>{t("suppliers.formDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("suppliers.name")} required>
              <Input name="name" placeholder={t("suppliers.namePlaceholder")} />
            </FormField>
            <FormField label={t("suppliers.gstin")} hint={t("suppliers.gstinHint")}>
              <Input name="gstin" placeholder={t("suppliers.gstinPlaceholder")} />
            </FormField>
            <FormField label={t("suppliers.phone")}>
              <Input name="phone" type="tel" placeholder={t("suppliers.phonePlaceholder")} />
            </FormField>
            <FormField label={t("suppliers.address")}>
              <Input name="address" placeholder={t("suppliers.addressPlaceholder")} />
            </FormField>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" isLoading={pending}>
              {t("suppliers.addSupplier")}
            </Button>
            {state.error && <span className="text-sm text-destructive">{state.error}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
