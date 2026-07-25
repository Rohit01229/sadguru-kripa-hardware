"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Input,
  Label,
  Select,
  formatQty,
  toast,
} from "@hardware/ui";
import { createProductAction, type ActionState } from "./actions";
import { ImageUploader } from "./ImageUploader";

interface UnitOpt {
  id: string;
  code: string;
  name: string;
  kind: "MEASURED" | "PIECE";
}
interface Opt {
  id: string;
  name: string;
}

interface SaleUnitRow {
  unitId: string;
  factorToBase: string;
  salePrice: string; // rupees
  mrp: string; // rupees
}

// Create-product form with the UoM editor (Chunk 6 "hard part"): a base unit plus
// N add-sale-unit rows, each carrying factorToBase + price + (decimal-vs-whole is
// the unit's kind). A PIECE base unit warns that fractional default qty is
// rejected — the real enforcement is server-side in uom.toBaseQty.
export function ProductForm({
  units,
  categories,
  brands,
}: {
  units: UnitOpt[];
  categories: Opt[];
  brands: Opt[];
}) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [baseUnitId, setBaseUnitId] = useState(units[0]?.id ?? "");
  const [rows, setRows] = useState<SaleUnitRow[]>([
    { unitId: units[0]?.id ?? "", factorToBase: "1", salePrice: "", mrp: "" },
  ]);
  const [defaultIdx, setDefaultIdx] = useState(0);
  const [images, setImages] = useState<string[]>([]);

  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await createProductAction(prev, fd);
    if (result.ok && result.id) {
      toast.success(t("form.toastCreated"));
      router.push(`/catalog/${result.id}`);
    } else if (result.error) {
      toast.error(result.error);
    }
    return result;
  }, {});

  const unitById = (id: string) => units.find((u) => u.id === id);
  const baseUnit = unitById(baseUnitId);

  function addRow() {
    setRows((r) => [...r, { unitId: units[0]?.id ?? "", factorToBase: "1", salePrice: "", mrp: "" }]);
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
    if (defaultIdx === i) setDefaultIdx(0);
    else if (defaultIdx > i) setDefaultIdx((d) => d - 1);
  }
  function setRow(i: number, patch: Partial<SaleUnitRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("form.sectionDetails")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("form.name")} required>
            <Input name="name" />
          </FormField>
          <FormField label={t("form.sku")} required hint={t("form.skuHint")}>
            <Input name="sku" />
          </FormField>
          <FormField label={t("form.category")} required>
            <Select name="categoryId" defaultValue="">
              <option value="" disabled>
                {t("form.selectPlaceholder")}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t("form.brand")} hint={t("form.brandHint")}>
            <Select name="brandId" defaultValue="">
              <option value="">—</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </FormField>
          <label className="flex min-h-[2.75rem] items-center gap-2 text-sm sm:col-span-2 sm:min-h-0">
            <Checkbox name="availableOnline" defaultChecked /> {t("form.availableOnline")}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">Images</CardTitle>
          <p className="text-xs text-muted-foreground">
            Optional. The first image is shown as the primary photo in the catalog and storefront.
          </p>
        </CardHeader>
        <CardContent>
          <ImageUploader value={images} onChange={setImages} name="imageKeys" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("form.sectionTax")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("form.hsnCode")} hint={t("form.hsnHint")}>
            <Input name="hsnCode" />
          </FormField>
          <FormField label={t("form.gstRate")} required>
            <Input name="gstRatePct" defaultValue="18" inputMode="decimal" />
          </FormField>
          <FormField label={t("form.costPerBaseUnit")} hint={t("form.costPerBaseUnitHint")}>
            <Input name="costPerBaseUnit" type="number" step="0.01" defaultValue="0" />
          </FormField>
          <div className="flex items-end">
            <label className="flex min-h-[2.75rem] items-center gap-2 text-sm sm:min-h-0">
              <Checkbox name="priceInclusive" /> {t("form.priceInclusive")}
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("form.sectionBaseUnit")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t("form.baseUnit")}
            required
            hint={t("form.baseUnitHint")}
          >
            <Select
              name="baseUnitId"
              value={baseUnitId}
              onChange={(e) => setBaseUnitId(e.target.value)}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name} ({u.kind})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t("form.reorderLevel")} hint={t("form.reorderLevelHint")}>
            <Input name="reorderLevel" inputMode="decimal" />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">{t("form.sectionSaleUnits")}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("form.saleUnitsIntroLead")}
            {baseUnit ? (
              <>
                {" "}(<span className="font-medium text-foreground">{baseUnit.code}</span>)
              </>
            ) : null}{" "}
            {t("form.saleUnitsIntroFactor")}{" "}
            <span className="font-medium text-foreground">{t("form.saleUnitsIntroFormula")}</span>.{" "}
            {t("form.saleUnitsIntroDefaultLead")}{" "}
            <span className="font-medium text-foreground">{t("form.saleUnitsIntroDefault")}</span>{" "}
            {t("form.saleUnitsIntroDefaultTail")}{" "}
            <span className="font-medium text-foreground">{t("form.saleUnitsIntroPiece")}</span>{" "}
            {t("form.saleUnitsIntroPieceTail")}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <input type="hidden" name="defaultSaleUnitIndex" value={defaultIdx} />

          {/* Column legend (hidden on small screens; rows carry their own labels there) */}
          <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid">
            <div className="col-span-3">{t("form.colSaleUnit")}</div>
            <div className="col-span-2">{t("form.colFactor")}</div>
            <div className="col-span-2">{t("form.colSalePrice")}</div>
            <div className="col-span-2">{t("form.colMrp")}</div>
            <div className="col-span-2">{t("form.colDefault")}</div>
            <div className="col-span-1" />
          </div>

          <div className="space-y-3">
            {rows.map((row, i) => {
              const u = unitById(row.unitId);
              const factorNum = Number(row.factorToBase);
              const showPreview =
                u && baseUnit && row.factorToBase !== "" && Number.isFinite(factorNum) && factorNum > 0;
              const isDefault = defaultIdx === i;
              return (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-12 sm:items-start sm:gap-2 sm:border-0 sm:p-0"
                >
                  <div className="sm:col-span-3">
                    <Label className="mb-1 block text-xs text-muted-foreground sm:hidden">{t("form.colSaleUnit")}</Label>
                    <Select
                      name="saleUnitId"
                      aria-label={t("form.ariaSaleUnit", { row: i + 1 })}
                      value={row.unitId}
                      onChange={(e) => setRow(i, { unitId: e.target.value })}
                    >
                      {units.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.code} ({opt.kind})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block text-xs text-muted-foreground sm:hidden">{t("form.colFactor")}</Label>
                    <Input
                      name="factorToBase"
                      aria-label={t("form.ariaFactor", { row: i + 1 })}
                      value={row.factorToBase}
                      onChange={(e) => setRow(i, { factorToBase: e.target.value })}
                      placeholder="1"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block text-xs text-muted-foreground sm:hidden">{t("form.colSalePrice")}</Label>
                    <Input
                      name="salePrice"
                      aria-label={t("form.ariaSalePrice", { row: i + 1 })}
                      type="number"
                      step="0.01"
                      value={row.salePrice}
                      onChange={(e) => setRow(i, { salePrice: e.target.value })}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block text-xs text-muted-foreground sm:hidden">{t("form.colMrp")}</Label>
                    <Input
                      name="mrp"
                      aria-label={t("form.ariaMrp", { row: i + 1 })}
                      type="number"
                      step="0.01"
                      value={row.mrp}
                      onChange={(e) => setRow(i, { mrp: e.target.value })}
                      placeholder={t("addSaleUnit.mrpPlaceholder")}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:col-span-3 sm:justify-start sm:pt-1.5">
                    <label className="flex min-h-[2.75rem] items-center gap-1.5 text-xs sm:min-h-0">
                      <input
                        type="radio"
                        name="defaultRadio"
                        className="h-4 w-4 accent-primary"
                        checked={isDefault}
                        onChange={() => setDefaultIdx(i)}
                      />
                      {t("form.default")}
                    </label>
                    {u?.kind === "PIECE" && (
                      <Badge variant="outline" className="text-[10px]">
                        {t("form.wholeOnly")}
                      </Badge>
                    )}
                    {rows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto min-h-[2.75rem] text-destructive hover:text-destructive sm:ml-0 sm:min-h-0"
                        onClick={() => removeRow(i)}
                        aria-label={t("form.ariaRemoveRow", { row: i + 1 })}
                      >
                        {tc("actions.remove")}
                      </Button>
                    )}
                  </div>

                  {showPreview && (
                    <p className="text-xs text-muted-foreground sm:col-span-12">
                      {t("form.previewConversion", {
                        unitCode: u!.code,
                        converted: formatQty(row.factorToBase, baseUnit!.code),
                      })}
                      {isDefault ? t("form.previewDefaultSuffix") : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            className="min-h-[2.75rem] w-full sm:h-8 sm:min-h-0 sm:w-auto sm:px-3 sm:text-xs"
          >
            {t("form.addSaleUnit")}
          </Button>
        </CardContent>
      </Card>

      {/* Stack full-width on mobile (>=44px tap targets); inline from sm up. */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          isLoading={pending}
          className="min-h-[2.75rem] w-full sm:w-auto"
        >
          {t("form.createProduct")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/catalog")}
          className="min-h-[2.75rem] w-full sm:w-auto"
        >
          {tc("actions.cancel")}
        </Button>
      </div>
    </form>
  );
}
