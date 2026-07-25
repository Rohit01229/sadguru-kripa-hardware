"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Card, EmptyState, Input, PageHeader, formatMoney } from "@hardware/ui";
import { useCart } from "./CartStore";

// Step a cart-line quantity by +/-1, clamped to the input's minimum. The cart does not
// know the unit kind (PIECE vs MEASURED), so steps are whole; any fractional value the
// shopper typed survives via the raw Input. Mirrors the AddToCart −/+ stepper affordance.
function stepQty(current: string, delta: number): string {
  const next = Math.max(0.001, (Number(current) || 0) + delta);
  return String(Number(next.toFixed(3)));
}

// Cart page — review/edit the client cart, then proceed to checkout. Prices are the
// display snapshots; the authoritative total + reservation happen at checkout. Mobile:
// each line stacks (name row, then stepper/total/remove row) and a sticky bottom bar
// carries the running total + checkout CTA so it's always reachable without scrolling.
export default function CartPage() {
  const { lines, updateQty, removeLine } = useCart();
  const t = useTranslations();

  // Display-only indicative total in integer paise (server re-prices at checkout).
  const itemTotalPaise = lines.reduce(
    (a, l) => a + Math.round(l.unitPricePaise * Number(l.quantity || 0)),
    0,
  );

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PageHeader size="2xl" title={t("cart.title")} />
        <EmptyState
          className="mt-8"
          title={t("cart.emptyTitle")}
          description={t("cart.emptyDescription")}
          action={
            <Button asChild>
              <Link href="/">{t("cart.browseCatalog")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader size="2xl" title={t("cart.title")} />

      <Card className="mt-6 divide-y">
        {lines.map((l) => (
          <div
            key={`${l.productId}:${l.saleUnitId}`}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.name}</p>
              <p className="text-xs text-muted-foreground">
                {t("cart.unitPriceEach", {
                  unitLabel: l.unitLabel,
                  price: formatMoney(l.unitPricePaise),
                })}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <div>
                <label htmlFor={`qty-${l.productId}-${l.saleUnitId}`} className="sr-only">
                  {t("cart.quantityLabel", { name: l.name })}
                </label>
                <div className="flex items-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-r-none sm:h-9 sm:w-9"
                    aria-label={t("cart.decreaseQuantity", { name: l.name })}
                    onClick={() =>
                      updateQty(l.productId, l.saleUnitId, stepQty(l.quantity, -1))
                    }
                  >
                    −
                  </Button>
                  <Input
                    id={`qty-${l.productId}-${l.saleUnitId}`}
                    type="number"
                    min={0.001}
                    step="any"
                    value={l.quantity}
                    onChange={(e) => updateQty(l.productId, l.saleUnitId, e.target.value)}
                    className="h-11 w-16 rounded-none text-center tabular-nums sm:h-9"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-l-none sm:h-9 sm:w-9"
                    aria-label={t("cart.increaseQuantity", { name: l.name })}
                    onClick={() =>
                      updateQty(l.productId, l.saleUnitId, stepQty(l.quantity, 1))
                    }
                  >
                    +
                  </Button>
                </div>
              </div>
              <span className="w-24 text-right text-sm font-medium tabular-nums">
                {formatMoney(Math.round(l.unitPricePaise * Number(l.quantity || 0)))}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => removeLine(l.productId, l.saleUnitId)}
                aria-label={t("cart.removeLabel", { name: l.name })}
              >
                {t("common.actions.remove")}
              </Button>
            </div>
          </div>
        ))}
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{t("cart.itemTotalIndicative")}</span>
        <span className="text-base font-semibold tabular-nums">{formatMoney(itemTotalPaise)}</span>
      </div>

      {/* Desktop: inline checkout CTA. */}
      <div className="mt-6 hidden justify-end sm:flex">
        <Button asChild size="lg">
          <Link href="/checkout">{t("cart.proceedToCheckout")}</Link>
        </Button>
      </div>

      {/* Spacer so the sticky bottom bar never hides the last cart line on mobile. */}
      <div className="h-24 sm:hidden" aria-hidden="true" />

      {/* Mobile: sticky bottom action bar (always-reachable checkout). */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("cart.itemTotal")}</p>
            <p className="text-base font-semibold tabular-nums">{formatMoney(itemTotalPaise)}</p>
          </div>
          <Button asChild size="lg" className="h-12 flex-1">
            <Link href="/checkout">{t("cart.checkout")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
