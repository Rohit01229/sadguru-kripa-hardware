"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Label, Select, toast } from "@hardware/ui";
import { setPriceSlabsAction, type ActionState } from "../actions";

interface SaleUnitOpt {
  id: string;
  unitCode: string;
}
interface Slab {
  minQty: string;
  price: string; // rupees
}

// Price-slab editor (pricing.write). Edits the full slab set for a chosen sale
// unit; submits to setPriceSlabsAction which replaces them in one tx.
export function PriceSlabEditor({
  productId,
  saleUnits,
  initial,
}: {
  productId: string;
  saleUnits: SaleUnitOpt[];
  initial: Record<string, { minQty: string; pricePerSaleUnit: number }[]>;
}) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [saleUnitId, setSaleUnitId] = useState(saleUnits[0]?.id ?? "");
  const [slabs, setSlabs] = useState<Slab[]>(toRows(initial[saleUnits[0]?.id ?? ""]));

  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await setPriceSlabsAction(productId, prev, fd);
    if (result.ok) {
      toast.success(t("slabs.toastSaved"));
      router.refresh();
    } else if (result.error) {
      toast.error(result.error);
    }
    return result;
  }, {});

  function switchUnit(id: string) {
    setSaleUnitId(id);
    setSlabs(toRows(initial[id]));
  }

  const selectedCode = saleUnits.find((s) => s.id === saleUnitId)?.unitCode;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="saleUnitId" value={saleUnitId} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="slab-unit" className="text-xs text-muted-foreground">
            {t("slabs.saleUnit")}
          </Label>
          <Select
            id="slab-unit"
            className="w-40"
            value={saleUnitId}
            onChange={(e) => switchUnit(e.target.value)}
          >
            {saleUnits.map((s) => (
              <option key={s.id} value={s.id}>
                {s.unitCode}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {slabs.length > 0 && (
        <div className="grid grid-cols-[8rem_8rem_auto] items-center gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("slabs.colMinQty")}</span>
          <span>
            {selectedCode
              ? t("slabs.colPricePerUnit", { unitCode: selectedCode })
              : t("slabs.colPricePerUnitFallback")}
          </span>
          <span className="sr-only">{t("slabs.actions")}</span>
        </div>
      )}

      <div className="space-y-2">
        {slabs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("slabs.emptyLead")}{" "}
            {selectedCode ? <span className="font-medium">{selectedCode}</span> : t("slabs.emptyUnitFallback")}.{" "}
            {t("slabs.emptyTail")}
          </p>
        ) : (
          slabs.map((s, i) => (
            <div key={i} className="grid grid-cols-[8rem_8rem_auto] items-center gap-2">
              <Input
                name="slabMinQty"
                aria-label={t("slabs.ariaMinQty", { slab: i + 1 })}
                value={s.minQty}
                onChange={(e) =>
                  setSlabs((r) => r.map((x, idx) => (idx === i ? { ...x, minQty: e.target.value } : x)))
                }
                placeholder={t("slabs.minQtyPlaceholder")}
                inputMode="decimal"
              />
              <Input
                name="slabPrice"
                aria-label={t("slabs.ariaPrice", { slab: i + 1 })}
                type="number"
                step="0.01"
                value={s.price}
                onChange={(e) =>
                  setSlabs((r) => r.map((x, idx) => (idx === i ? { ...x, price: e.target.value } : x)))
                }
                placeholder="0.00"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setSlabs((r) => r.filter((_, idx) => idx !== i))}
                aria-label={t("slabs.ariaRemove", { slab: i + 1 })}
              >
                {tc("actions.remove")}
              </Button>
            </div>
          ))
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSlabs((r) => [...r, { minQty: "", price: "" }])}
        >
          {t("slabs.addSlab")}
        </Button>
      </div>

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <Button type="submit" isLoading={pending}>
        {t("slabs.save")}
      </Button>
    </form>
  );
}

function toRows(slabs?: { minQty: string; pricePerSaleUnit: number }[]): Slab[] {
  if (!slabs || slabs.length === 0) return [];
  return slabs.map((s) => ({ minQty: s.minQty, price: (s.pricePerSaleUnit / 100).toFixed(2) }));
}
