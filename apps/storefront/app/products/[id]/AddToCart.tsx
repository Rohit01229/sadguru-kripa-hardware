"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, Input, Label, Select, formatMoney, toast } from "@hardware/ui";
import { useCart } from "../../cart/CartStore";

export interface SaleUnitOption {
  id: string;
  unitCode: string;
  unitName: string;
  unitKind: "MEASURED" | "PIECE";
  salePrice: number; // paise
}

// Product-page "Add to cart": pick a sale unit + qty (PIECE units are whole-only,
// step 1; MEASURED allow decimals), then push the line into the client cart. Live
// stock + price are display-only here — the authoritative reserve happens at checkout.
export function AddToCart({
  productId,
  name,
  saleUnits,
  inStock,
}: {
  productId: string;
  name: string;
  saleUnits: SaleUnitOption[];
  inStock: boolean;
}) {
  const t = useTranslations("catalog");
  const { addLine } = useCart();
  const router = useRouter();
  const [saleUnitId, setSaleUnitId] = useState(saleUnits[0]?.id ?? "");
  const [qty, setQty] = useState("1");

  const su = saleUnits.find((s) => s.id === saleUnitId);
  const isPiece = su?.unitKind === "PIECE";

  if (saleUnits.length === 0) return null;

  function add(): boolean {
    if (!su) return false;
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      toast.error(t("cart.errorQtyTooLow"));
      return false;
    }
    if (isPiece && !Number.isInteger(q)) {
      toast.error(t("cart.errorWholePieces"));
      return false;
    }
    addLine({
      productId,
      saleUnitId: su.id,
      quantity: String(q),
      name,
      unitLabel: `${su.unitName} (${su.unitCode})`,
      unitPricePaise: su.salePrice,
    });
    return true;
  }

  function handleAdd() {
    if (add()) toast.success(t("cart.added"), { description: name });
  }

  function handleBuyNow() {
    if (add()) router.push("/cart");
  }

  function stepQty(delta: number) {
    const current = Number(qty) || 0;
    const next = Math.max(isPiece ? 1 : 0.001, current + delta);
    setQty(isPiece ? String(Math.round(next)) : String(Number(next.toFixed(3))));
  }

  return (
    <Card className="mt-6 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="sale-unit">{t("cart.unit")}</Label>
          <Select
            id="sale-unit"
            value={saleUnitId}
            onChange={(e) => setSaleUnitId(e.target.value)}
            className="h-11 w-full min-w-0 sm:h-9 sm:w-auto sm:min-w-[14rem]"
          >
            {saleUnits.map((s) => (
              <option key={s.id} value={s.id}>
                {s.unitName} ({s.unitCode}) — {formatMoney(s.salePrice)}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="qty">{t("cart.quantity")}</Label>
          <div className="flex items-center">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-r-none sm:h-9 sm:w-9"
              aria-label={t("cart.decreaseQuantity")}
              disabled={!inStock}
              onClick={() => stepQty(isPiece ? -1 : -1)}
            >
              −
            </Button>
            <Input
              id="qty"
              type="number"
              min={isPiece ? 1 : 0.001}
              step={isPiece ? 1 : "any"}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={!inStock}
              className="h-11 w-20 rounded-none text-center tabular-nums sm:h-9"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-l-none sm:h-9 sm:w-9"
              aria-label={t("cart.increaseQuantity")}
              disabled={!inStock}
              onClick={() => stepQty(1)}
            >
              +
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!inStock}
            className="h-11 sm:h-9"
          >
            {t("cart.addToCart")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleBuyNow}
            disabled={!inStock}
            className="h-11 sm:h-9"
          >
            {t("cart.buyNow")}
          </Button>
        </div>
      </div>

      {isPiece && (
        <p className="mt-3 text-xs text-muted-foreground">{t("cart.wholePiecesNote")}</p>
      )}
      {!inStock && (
        <p className="mt-3 text-xs text-muted-foreground">{t("cart.outOfStockNote")}</p>
      )}
    </Card>
  );
}
