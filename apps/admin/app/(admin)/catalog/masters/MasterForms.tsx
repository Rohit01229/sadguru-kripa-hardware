"use client";

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label, Select, toast } from "@hardware/ui";
import {
  createUnitAction,
  createCategoryAction,
  createBrandAction,
  type ActionState,
} from "../actions";

function useCreateAction(
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>,
  successMessage: string,
  formRef: React.RefObject<HTMLFormElement | null>,
) {
  const router = useRouter();
  return useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.ok) {
      toast.success(successMessage);
      formRef.current?.reset();
      router.refresh();
    } else if (result.error) {
      toast.error(result.error);
    }
    return result;
  }, {});
}

export function UnitForm() {
  const t = useTranslations("catalog");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useCreateAction(createUnitAction, t("masters.toastUnitAdded"), formRef);
  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="unit-code" className="text-xs text-muted-foreground">
          {t("masters.unitCode")}
        </Label>
        <Input id="unit-code" name="code" placeholder={t("masters.unitCodePlaceholder")} required className="w-32" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="unit-name" className="text-xs text-muted-foreground">
          {t("masters.unitName")}
        </Label>
        <Input id="unit-name" name="name" placeholder={t("masters.unitNamePlaceholder")} required className="w-44" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="unit-kind" className="text-xs text-muted-foreground">
          {t("masters.unitKind")}
        </Label>
        <Select id="unit-kind" name="kind" defaultValue="MEASURED" className="w-40">
          <option value="MEASURED">MEASURED</option>
          <option value="PIECE">PIECE</option>
        </Select>
      </div>
      <Button type="submit" variant="outline" isLoading={pending}>
        {t("masters.addUnit")}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

export function CategoryForm({ options }: { options: { id: string; name: string }[] }) {
  const t = useTranslations("catalog");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useCreateAction(createCategoryAction, t("masters.toastCategoryAdded"), formRef);
  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="cat-name" className="text-xs text-muted-foreground">
          {t("masters.categoryName")}
        </Label>
        <Input id="cat-name" name="name" placeholder={t("masters.categoryNamePlaceholder")} required className="w-52" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cat-parent" className="text-xs text-muted-foreground">
          {t("masters.categoryParent")}
        </Label>
        <Select id="cat-parent" name="parentId" defaultValue="" className="w-52">
          <option value="">{t("masters.categoryTopLevel")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="outline" isLoading={pending}>
        {t("masters.addCategory")}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

export function BrandForm() {
  const t = useTranslations("catalog");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useCreateAction(createBrandAction, t("masters.toastBrandAdded"), formRef);
  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="brand-name" className="text-xs text-muted-foreground">
          {t("masters.brandName")}
        </Label>
        <Input id="brand-name" name="name" placeholder={t("masters.brandNamePlaceholder")} required className="w-52" />
      </div>
      <Button type="submit" variant="outline" isLoading={pending}>
        {t("masters.addBrand")}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
