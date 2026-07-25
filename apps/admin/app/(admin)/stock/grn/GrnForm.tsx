"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  FormField,
  Input,
  Select,
  Button,
  EmptyState,
  formatMoney,
  toast,
} from "@hardware/ui";
import { recordGrnAction, type ActionState } from "../actions";

interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  baseUnitCode: string;
  saleUnits: { id: string; label: string }[];
}

interface LineState {
  key: number;
  productId: string;
  quantity: string;
  cost: string;
}

// GRN entry form. Dynamic line rows (product · receive unit · qty · batch/expiry ·
// cost). A fresh idempotencyKey is generated per mount so an accidental double-
// submit is a no-op server-side (04 §5). Server action enforces stock.grn + audit.
//
// The "Est. total" column + footer are a DISPLAY-ONLY preview (qty × cost). The
// server stays authoritative for every paise of stock value — these numbers are
// never sent back as totals.
export function GrnForm({ products, suppliers }: { products: ProductOpt[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const t = useTranslations("stock");
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const [lines, setLines] = useState<LineState[]>([
    { key: 1, productId: products[0]?.id ?? "", quantity: "", cost: "" },
  ]);
  const [nextKey, setNextKey] = useState(2);

  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await recordGrnAction(prev, fd);
    if (result.ok) {
      toast.success(t("grn.toastSuccess"));
      router.push("/stock");
    } else if (result.error) {
      toast.error(result.error);
    }
    return result;
  }, {});

  const addLine = () => {
    setLines((ls) => [...ls, { key: nextKey, productId: products[0]?.id ?? "", quantity: "", cost: "" }]);
    setNextKey((k) => k + 1);
  };
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const patchLine = (key: number, patch: Partial<LineState>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Display-only estimated total (paise). Never sent to the server.
  const lineTotalPaise = (l: LineState) => {
    const qty = Number(l.quantity);
    const cost = Number(l.cost);
    if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0 || cost <= 0) return 0;
    return Math.round(qty * cost * 100);
  };
  const estTotalPaise = lines.reduce((sum, l) => sum + lineTotalPaise(l), 0);

  if (products.length === 0) {
    return (
      <EmptyState
        title={t("grn.emptyTitle")}
        description={t("grn.emptyDescription")}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <Card>
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-3">
          <FormField label={t("grn.supplier")} hint={t("grn.supplierHint")}>
            <Select name="supplierId" defaultValue="">
              <option value="">{t("grn.supplierNone")}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t("grn.supplierInvoiceNo")}>
            <Input name="supplierInvoiceNo" placeholder={t("grn.optional")} />
          </FormField>
          <FormField label={t("grn.note")}>
            <Input name="note" placeholder={t("grn.optional")} />
          </FormField>
        </CardContent>
      </Card>

      {/*
        Each GRN line is a self-contained card whose fields reflow from a single
        column (mobile) to a labelled grid (sm+). Every line renders exactly one
        input per field name, in the same order, so the server action's parallel
        `getAll()` arrays stay index-aligned. Replacing the wide 8-column table with
        cards removes horizontal overflow at ~360px while keeping the desktop layout
        dense (4 fields per row on lg).
      */}
      <ul className="space-y-4">
        {lines.map((line, idx) => {
          const product = products.find((p) => p.id === line.productId) ?? products[0]!;
          const total = lineTotalPaise(line);
          return (
            <li key={line.key} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{t("grn.line", { number: idx + 1 })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(line.key)}
                  disabled={lines.length === 1}
                  aria-label={t("grn.removeLineAria", { number: idx + 1 })}
                >
                  {t("grn.remove")}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label={t("grn.product")} className="sm:col-span-2 lg:col-span-2">
                  <Select
                    name="productId"
                    value={line.productId}
                    onChange={(e) => patchLine(line.key, { productId: e.target.value })}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </Select>
                </FormField>

                <FormField label={t("grn.receiveUnit")}>
                  <Select name="receiveUnitId" defaultValue={product.saleUnits[0]?.id}>
                    {product.saleUnits.map((su) => (
                      <option key={su.id} value={su.id}>
                        {su.label}
                      </option>
                    ))}
                  </Select>
                </FormField>

                <FormField label={t("grn.qty")} required>
                  <Input
                    name="quantity"
                    required
                    inputMode="decimal"
                    placeholder={t("grn.qtyPlaceholder")}
                    value={line.quantity}
                    onChange={(e) => patchLine(line.key, { quantity: e.target.value })}
                    className="tabular-nums"
                  />
                </FormField>

                <FormField label={t("grn.batchNo")}>
                  <Input name="batchNo" placeholder={t("grn.optional")} />
                </FormField>

                <FormField label={t("grn.expiry")}>
                  <Input name="expiryDate" type="date" />
                </FormField>

                <FormField label={t("grn.costPerUnit")}>
                  <Input
                    name="costPerReceiveUnit"
                    inputMode="decimal"
                    placeholder={t("grn.costPlaceholder")}
                    value={line.cost}
                    onChange={(e) => patchLine(line.key, { cost: e.target.value })}
                    className="tabular-nums"
                  />
                </FormField>

                <div className="flex flex-col justify-end">
                  <span className="text-xs text-muted-foreground">{t("grn.estTotal")}</span>
                  <span className="mt-1 text-sm font-medium tabular-nums">
                    {total > 0 ? formatMoney(total) : "—"}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={addLine}
          className="h-11 w-full sm:h-9 sm:w-auto"
        >
          {t("grn.addLine")}
        </Button>
        <div className="text-sm text-muted-foreground">
          {t("grn.estimatedTotal")}{" "}
          <span className="font-semibold tabular-nums text-foreground">{formatMoney(estTotalPaise)}</span>
          <span className="ml-1 text-xs">{t("grn.previewNote")}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" isLoading={pending} className="h-11 w-full sm:h-9 sm:w-auto">
          {t("grn.recordGrn")}
        </Button>
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
