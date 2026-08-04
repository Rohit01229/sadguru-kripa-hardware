"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  FormField,
  Input,
  Label,
  Select,
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
interface HsnHit {
  code: string;
  description: string;
  gstRatePct: string;
}

/** Sentinel the category/brand selects use for "＋ Other (add new)…". */
const OTHER = "__other__";

/**
 * Quick "New Item" form — the myBillBook-shaped path to adding stock (19 §2).
 *
 * The whole point is that **Item Name + Selling Price is enough**. Item Code, Category
 * and Unit are optional because the server fills them in (auto-SKU + the shop's default
 * "General"/PCS masters), so a first-time shopkeeper is never blocked on set-up.
 * Everything a bigger shop needs — purchase price, MRP, wholesale rate, opening stock,
 * HSN, barcode, images — lives behind ONE "Add more details" toggle, in myBillBook's
 * field order, rather than five always-open sections.
 *
 * The detailed form (multiple sale units + conversion factors) still exists and is
 * linked at the bottom; nothing was removed, only moved off the default path.
 */
export function ItemForm({
  units,
  categories,
  brands,
  defaultGstRate,
}: {
  units: UnitOpt[];
  categories: Opt[];
  brands: Opt[];
  /** The shop's last-used GST rate, so tax is pre-filled instead of re-typed. */
  defaultGstRate: string;
}) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // Which button submitted. A ref (not state) because it must be readable inside the
  // action callback without causing a re-render between click and submit.
  const saveAndNew = useRef(false);

  const [name, setName] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [hsnCode, setHsnCode] = useState("");
  const [gstRate, setGstRate] = useState(defaultGstRate);

  // "Find HSN Code" — myBillBook's affordance: search by the item NAME, then picking a
  // result fills the code AND its usual GST rate.
  const [hsnHits, setHsnHits] = useState<HsnHit[] | null>(null);
  const [hsnBusy, setHsnBusy] = useState(false);

  async function findHsn() {
    if (!name.trim()) {
      toast.error(t("form.hsnNeedName"));
      return;
    }
    setHsnBusy(true);
    try {
      const res = await fetch(`/api/hsn?q=${encodeURIComponent(name)}`);
      const json = (await res.json()) as { data?: HsnHit[] };
      setHsnHits(json.data ?? []);
    } catch {
      setHsnHits([]);
    } finally {
      setHsnBusy(false);
    }
  }

  function pickHsn(hit: HsnHit) {
    setHsnCode(hit.code);
    setGstRate(hit.gstRatePct);
    setHsnHits(null);
  }

  function resetForNext() {
    formRef.current?.reset();
    setName("");
    setCategoryId("");
    setBrandId("");
    setImages([]);
    setHsnCode("");
    setHsnHits(null);
    setGstRate(defaultGstRate);
    // Keep "more details" open if they were using it — a shopkeeper adding several
    // detailed items in a row should not have to re-open it every time.
    formRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  }

  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await createProductAction(prev, fd);
    if (result.ok && result.id) {
      if (saveAndNew.current) {
        toast.success(t("form.toastCreatedNew"));
        resetForNext();
      } else {
        toast.success(t("form.toastCreated"));
        router.push(`/catalog/${result.id}`);
      }
    } else if (result.error) {
      toast.error(result.error);
    }
    saveAndNew.current = false;
    return result;
  }, {});

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}

      {/* ── Essentials: name + price is a complete item ── */}
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField label={t("form.itemName")} required>
              <Input
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("form.itemNamePlaceholder")}
                autoFocus
                autoComplete="off"
              />
            </FormField>
          </div>

          <FormField label={`${t("form.sellingPrice")} (₹)`} required>
            <Input name="salePrice" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" />
          </FormField>

          <FormField label={t("form.unit")}>
            <Select name="baseUnitId" defaultValue={preferredUnitId(units)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label={`${t("form.gstTaxRate")} (%)`}>
            <Select name="gstRatePct" value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
              {["0", "0.25", "3", "5", "12", "18", "28"].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label={t("form.openingStock")} hint={t("form.openingStockHint")}>
            <Input name="openingStock" type="number" step="0.001" min="0" inputMode="decimal" placeholder="0" />
          </FormField>
        </CardContent>
      </Card>

      {/* ── One toggle for everything else (myBillBook's "Add more details") ── */}
      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-expanded={showMore}
      >
        <span aria-hidden="true" className="text-base leading-none">
          {showMore ? "−" : "+"}
        </span>
        {showMore ? t("form.hideMoreDetails") : t("form.addMoreDetails")}
      </button>

      {showMore && (
        <div className="space-y-4">
          {/* Item details */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("form.groupItemDetails")}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t("form.itemCode")} hint={t("form.itemCodeHint")}>
                  <Input name="sku" placeholder={t("form.itemCodeAuto")} autoComplete="off" />
                </FormField>
                <FormField label={t("form.barcode")} hint={t("form.barcodeHint")}>
                  <Input name="barcode" placeholder="8901234567890" autoComplete="off" />
                </FormField>

                <FormField label={t("form.category")}>
                  <Select name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">{t("form.selectPlaceholder")}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value={OTHER}>{t("form.optionOther")}</option>
                  </Select>
                </FormField>
                {categoryId === OTHER && (
                  <FormField label={t("form.newCategory")}>
                    <Input name="categoryNameOther" autoComplete="off" />
                  </FormField>
                )}

                <FormField label={t("form.brand")}>
                  <Select name="brandId" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                    <option value="">—</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                    <option value={OTHER}>{t("form.optionOther")}</option>
                  </Select>
                </FormField>
                {brandId === OTHER && (
                  <FormField label={t("form.newBrand")}>
                    <Input name="brandNameOther" autoComplete="off" />
                  </FormField>
                )}
              </div>

              <div>
                <Label className="mb-2 block">{t("form.itemImages")}</Label>
                <ImageUploader value={images} onChange={setImages} name="imageKeys" />
              </div>
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("form.groupPricing")}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={`${t("form.purchasePrice")} (₹)`} hint={t("form.purchasePriceHint")}>
                  <Input name="costPerBaseUnit" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" />
                </FormField>
                <FormField label={`${t("form.mrp")} (₹)`}>
                  <Input name="mrp" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" />
                </FormField>
                <FormField label={`${t("form.wholesalePrice")} (₹)`} hint={t("form.wholesaleHint")}>
                  <Input name="wholesalePrice" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" />
                </FormField>
                <FormField label={t("form.wholesaleMinQty")}>
                  <Input name="wholesaleMinQty" type="number" step="0.001" min="0" inputMode="decimal" placeholder="0" />
                </FormField>
              </div>
              <label className="flex min-h-[2.75rem] items-center gap-2 text-sm sm:min-h-0">
                <Checkbox name="priceInclusive" /> {t("form.priceInclusive")}
              </label>
            </CardContent>
          </Card>

          {/* Tax — with the "Find HSN Code" affordance */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("form.groupTax")}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t("form.hsnSac")}>
                  <div className="flex gap-2">
                    <Input
                      name="hsnCode"
                      value={hsnCode}
                      onChange={(e) => setHsnCode(e.target.value)}
                      placeholder="2523"
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    <Button type="button" variant="outline" onClick={findHsn} disabled={hsnBusy}>
                      {hsnBusy ? t("form.hsnSearching") : t("form.findHsn")}
                    </Button>
                  </div>
                </FormField>
                <FormField label={t("form.lowStockAlert")} hint={t("form.lowStockAlertHint")}>
                  <Input name="reorderLevel" type="number" step="0.001" min="0" inputMode="decimal" placeholder="0" />
                </FormField>
              </div>

              {hsnHits !== null && (
                <div className="rounded-md border bg-muted/30 p-3">
                  {hsnHits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("form.hsnNoResults")}</p>
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">{t("form.hsnPickHint")}</p>
                      <ul className="space-y-1">
                        {hsnHits.map((hit) => (
                          <li key={hit.code}>
                            <button
                              type="button"
                              onClick={() => pickHsn(hit)}
                              className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                            >
                              <span className="font-mono font-semibold">{hit.code}</span>
                              <span className="flex-1 text-muted-foreground">{hit.description}</span>
                              <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-xs font-medium">
                                {hit.gstRatePct}%
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">{t("form.hsnRateNote")}</p>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Options */}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("form.groupOptions")}
              </p>
              <label className="flex min-h-[2.75rem] items-center gap-2 text-sm sm:min-h-0">
                <Checkbox name="availableOnline" defaultChecked /> {t("form.availableOnline")}
              </label>
              <label className="flex min-h-[2.75rem] items-center gap-2 text-sm sm:min-h-0">
                <Checkbox name="trackExpiry" /> {t("form.trackExpiry")}
              </label>
              <label className="flex min-h-[2.75rem] items-center gap-2 text-sm sm:min-h-0">
                <Checkbox name="allowNegative" /> {t("form.allowNegative")}
              </label>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Save / Save & New ── */}
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur sm:flex-row sm:justify-end">
        <Button
          type="submit"
          variant="outline"
          disabled={pending}
          onClick={() => {
            saveAndNew.current = true;
          }}
        >
          {t("form.saveAndNew")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : t("form.save")}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/catalog/new/detailed" className="underline underline-offset-2 hover:text-foreground">
          {t("form.switchToFullForm")}
        </Link>
      </p>
    </form>
  );
}

/** Default the unit select to PCS when the shop has it — the commonest case by far. */
function preferredUnitId(units: UnitOpt[]): string {
  const pcs = units.find((u) => u.code.toUpperCase() === "PCS");
  return (pcs ?? units[0])?.id ?? "";
}
