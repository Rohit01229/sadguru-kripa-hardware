"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
  Select,
  Label,
  Checkbox,
  Button,
  toast,
} from "@hardware/ui";
import { adjustStockAction, recordReturnAction, type ActionState } from "../actions";

interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  baseUnitCode: string;
  saleUnits: { id: string; label: string }[];
}

function ProductUnitPicker({ products }: { products: ProductOpt[] }) {
  const t = useTranslations("stock");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId) ?? products[0]!;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label={t("adjust.pickerProduct")}>
        <Select name="productId" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sku})
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("adjust.pickerUnit")}>
        <Select name="saleUnitId" defaultValue={product.saleUnits[0]?.id}>
          {product.saleUnits.map((su) => (
            <option key={su.id} value={su.id}>
              {su.label}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}

function useRefreshAction(
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>,
  successMessage: string,
  formRef: React.RefObject<HTMLFormElement | null>,
) {
  const router = useRouter();
  const result = useActionState<ActionState, FormData>(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res.ok) router.refresh();
    return res;
  }, {});
  const [state] = result;

  useEffect(() => {
    if (state.ok) {
      toast.success(successMessage);
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, successMessage, formRef]);

  return result;
}

export function AdjustForm({ products }: { products: ProductOpt[] }) {
  const t = useTranslations("stock");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useRefreshAction(
    adjustStockAction,
    t("adjust.toastAdjustmentRecorded"),
    formRef,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adjust.adjustTitle")}</CardTitle>
        <CardDescription>
          {t("adjust.adjustDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <ProductUnitPicker products={products} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label={t("adjust.direction")}>
              <Select name="direction" defaultValue="OUT">
                <option value="IN">{t("adjust.directionIn")}</option>
                <option value="OUT">{t("adjust.directionOut")}</option>
              </Select>
            </FormField>
            <FormField label={t("adjust.quantity")} required>
              <Input name="quantity" inputMode="decimal" placeholder={t("adjust.quantityPlaceholder")} />
            </FormField>
            <FormField label={t("adjust.batch")} hint={t("adjust.batchHint")}>
              <Input name="batchNo" placeholder={t("adjust.optional")} />
            </FormField>
            <FormField label={t("adjust.reason")} required>
              <Input name="reason" placeholder={t("adjust.reasonPlaceholder")} />
            </FormField>
          </div>
          <Label htmlFor="adjust-allow-negative" className="flex items-center gap-2 font-normal text-muted-foreground">
            <Checkbox id="adjust-allow-negative" name="allowNegative" value="true" />
            {t("adjust.allowNegative")}
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" isLoading={pending} className="h-11 w-full sm:h-9 sm:w-auto">
              {t("adjust.applyAdjustment")}
            </Button>
            {state.error && <span className="text-sm text-destructive">{state.error}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ReturnForm({ products }: { products: ProductOpt[] }) {
  const t = useTranslations("stock");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useRefreshAction(
    recordReturnAction,
    t("adjust.toastReturnRecorded"),
    formRef,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adjust.returnTitle")}</CardTitle>
        <CardDescription>
          {t("adjust.returnDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <ProductUnitPicker products={products} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label={t("adjust.kind")}>
              <Select name="kind" defaultValue="SALES">
                <option value="SALES">{t("adjust.kindSales")}</option>
                <option value="PURCHASE">{t("adjust.kindPurchase")}</option>
              </Select>
            </FormField>
            <FormField label={t("adjust.quantity")} required>
              <Input name="quantity" inputMode="decimal" placeholder={t("adjust.quantityPlaceholder")} />
            </FormField>
            <FormField label={t("adjust.reference")} hint={t("adjust.referenceHint")}>
              <Input name="refId" placeholder={t("adjust.referencePlaceholder")} />
            </FormField>
            <FormField label={t("adjust.reason")} required>
              <Input name="reason" placeholder={t("adjust.returnReasonPlaceholder")} />
            </FormField>
          </div>
          <Label htmlFor="return-allow-negative" className="flex items-center gap-2 font-normal text-muted-foreground">
            <Checkbox id="return-allow-negative" name="allowNegative" value="true" />
            {t("adjust.allowNegative")}
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" isLoading={pending} className="h-11 w-full sm:h-9 sm:w-auto">
              {t("adjust.recordReturn")}
            </Button>
            {state.error && <span className="text-sm text-destructive">{state.error}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
