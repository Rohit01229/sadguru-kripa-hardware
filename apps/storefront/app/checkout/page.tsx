"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  cn,
  formatMoney,
  formatQty,
  toast,
} from "@hardware/ui";
import { useCart } from "../cart/CartStore";

interface Address {
  id: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}
interface CartPriceLine {
  productId: string;
  saleUnitId: string;
  inStock: boolean;
  available: string;
}
interface CartPrice {
  itemTotal: number;
  deliveryFee: number;
  grandTotal: number;
  placeOfSupplyState: string;
  taxKind: "CGST_SGST" | "IGST";
  lines: CartPriceLine[];
}

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random();
}

// Checkout (04 §8.5): address / GSTIN / delivery-or-pickup / payment. Previews the
// priced cart (item total + delivery fee + place-of-supply tax kind) via /api/cart,
// then places the order (atomic reserve) via /api/orders with an Idempotency-Key.
// Online payment (Razorpay) is disabled for now — orders are always PAY_LATER
// (pay at store / on delivery); staff mark them paid from the admin order screen.
export default function CheckoutPage() {
  const t = useTranslations("checkout");
  const tc = useTranslations("common");
  const { lines, clear } = useCart();
  const router = useRouter();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [fulfilment, setFulfilment] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [addressId, setAddressId] = useState<string>("");
  const [gstin, setGstin] = useState("");
  // Online payment (Razorpay) is disabled for now — every order is pay-at-store /
  // on-delivery. Re-enable by restoring the payment-method selector + gateway call.
  const [price, setPrice] = useState<CartPrice | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(uuid);

  const items = useMemo(
    () => lines.map((l) => ({ productId: l.productId, saleUnitId: l.saleUnitId, quantity: l.quantity })),
    [lines],
  );

  // Load the customer's addresses (also tells us if they are signed in).
  useEffect(() => {
    fetch("/api/account/addresses")
      .then(async (r) => {
        if (r.status === 401) {
          setAuthed(false);
          return [];
        }
        setAuthed(true);
        return (await r.json()) as Address[];
      })
      .then((a) => {
        setAddresses(a);
        const def = a.find((x) => x.isDefault) ?? a[0];
        if (def) setAddressId(def.id);
      })
      .catch(() => setAuthed(false));
  }, []);

  // Re-price whenever the inputs change. The /api/cart route is session-scoped and
  // 401s for signed-out visitors, so only fire once auth has resolved to signed-in
  // (skip while authed is null/false) to avoid a redundant call + a spurious null price.
  useEffect(() => {
    if (items.length === 0 || authed !== true) return;
    fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, fulfilment, addressId: fulfilment === "DELIVERY" ? addressId || null : null }),
    })
      .then(async (r) => (r.ok ? ((await r.json()) as CartPrice) : null))
      .then(setPrice)
      .catch(() => setPrice(null));
  }, [items, fulfilment, addressId, authed]);

  async function placeOrder() {
    setError(null);
    setPlacing(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey },
        body: JSON.stringify({
          fulfilment: { type: fulfilment, addressId: fulfilment === "DELIVERY" ? addressId : null },
          lines: items,
          gstin: gstin.trim() || null,
          paymentMethod: "PAY_LATER",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data?.error?.message ?? t("errors.couldNotPlace");
        setError(message);
        toast.error(message);
        setPlacing(false);
        return;
      }
      clear();
      router.push(`/orders/${data.id}`);
    } catch {
      const message = t("errors.network");
      setError(message);
      toast.error(message);
      setPlacing(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PageHeader size="2xl" title={t("title")} />
        <EmptyState
          className="mt-8"
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild>
              <Link href="/">{t("empty.browseCatalog")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (authed === false) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PageHeader size="2xl" title={t("title")} />
        <EmptyState
          className="mt-8"
          title={t("signInRequired.title")}
          description={t("signInRequired.description")}
          action={
            <Button asChild>
              <Link href="/account">{tc("shell.signInRegister")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Name the short line(s) so the customer knows what to reduce (price.lines carries
  // per-line inStock/available; the cart lines carry the display name + unit label).
  const shortLines = (price?.lines ?? [])
    .filter((l) => !l.inStock)
    .map((l) => {
      const cartLine = lines.find(
        (c) => c.productId === l.productId && c.saleUnitId === l.saleUnitId,
      );
      return {
        key: `${l.productId}:${l.saleUnitId}`,
        name: cartLine?.name ?? "Item",
        unitLabel: cartLine?.unitLabel ?? null,
        available: l.available,
      };
    });
  const outOfStock = shortLines.length > 0;
  const submitDisabled = placing || outOfStock || (fulfilment === "DELIVERY" && !addressId);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader size="2xl" title={t("title")} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left: order form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("fulfilment.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <FulfilmentOption
                label={t("fulfilment.delivery.label")}
                description={t("fulfilment.delivery.description")}
                checked={fulfilment === "DELIVERY"}
                onSelect={() => setFulfilment("DELIVERY")}
                name="fulfilment"
              />
              <FulfilmentOption
                label={t("fulfilment.pickup.label")}
                description={t("fulfilment.pickup.description")}
                checked={fulfilment === "PICKUP"}
                onSelect={() => setFulfilment("PICKUP")}
                name="fulfilment"
              />
            </CardContent>
          </Card>

          {fulfilment === "DELIVERY" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("address.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                {addresses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("address.noneSaved")}{" "}
                    <Link href="/account" className="font-medium text-primary hover:underline">
                      {t("address.addOne")}
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="address">{t("address.shipTo")}</Label>
                    <Select id="address" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                      {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.line1}, {a.city} — {a.state} {a.pincode}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("gstin.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <Label htmlFor="gstin">{t("gstin.label")}</Label>
                <Input
                  id="gstin"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  placeholder={t("gstin.placeholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {t("gstin.hint")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("payment.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Online payment is disabled for now — pay-at-store / on-delivery only. */}
              <div className="flex items-start gap-3 rounded-md border border-primary bg-primary/5 p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t("payment.payLater.label")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("payment.payLater.description")}
                  </span>
                </span>
                <Badge variant="info" className="ml-auto">
                  {t("option.selected")}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: sticky order summary */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("summary.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {price ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("summary.itemTotal")}</span>
                    <span className="tabular-nums">{formatMoney(price.itemTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("summary.deliveryFee")}</span>
                    <span className="tabular-nums">
                      {price.deliveryFee === 0 ? t("summary.free") : formatMoney(price.deliveryFee)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-3 text-base font-semibold">
                    <span>{t("summary.grandTotal")}</span>
                    <span className="tabular-nums">{formatMoney(price.grandTotal)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("summary.taxLine", {
                      taxKind: price.taxKind === "IGST" ? t("summary.taxIgst") : t("summary.taxCgstSgst"),
                      state: price.placeOfSupplyState,
                    })}
                  </p>
                  {outOfStock && (
                    <Alert
                      variant="destructive"
                      title={t("stock.title")}
                      description={
                        <>
                          <p>{t("stock.reducePrompt")}</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {shortLines.map((l) => (
                              <li key={l.key}>
                                <span className="font-medium">{l.name}</span>
                                {l.unitLabel ? ` (${l.unitLabel})` : ""} —{" "}
                                {t("stock.available", { qty: formatQty(l.available) })}
                              </li>
                            ))}
                          </ul>
                        </>
                      }
                    />
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">{t("summary.calculating")}</p>
              )}

              {error && <Alert variant="destructive" description={error} />}

              {/* Desktop: Place order lives in the summary card. On mobile it moves to the
                  sticky bottom bar below so it's always reachable. */}
              <Button
                type="button"
                size="lg"
                className="hidden w-full lg:flex"
                onClick={placeOrder}
                disabled={submitDisabled}
                isLoading={placing}
              >
                {t("placeOrder")}
              </Button>
              {fulfilment === "DELIVERY" && !addressId && addresses.length > 0 && (
                <p className="text-center text-xs text-muted-foreground lg:block">
                  {t("address.selectPrompt")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Spacer so the sticky bar never covers the last form control on mobile. */}
      <div className="h-24 lg:hidden" aria-hidden="true" />

      {/* Mobile/tablet: sticky bottom action bar with the grand total + Place order. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {price ? t("summary.grandTotalShort") : t("summary.total")}
            </p>
            <p className="text-base font-semibold tabular-nums">
              {price ? formatMoney(price.grandTotal) : "—"}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            className="h-12 flex-1"
            onClick={placeOrder}
            disabled={submitDisabled}
            isLoading={placing}
          >
            {t("placeOrder")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FulfilmentOption({
  label,
  description,
  checked,
  onSelect,
  name,
}: {
  label: string;
  description: string;
  checked: boolean;
  onSelect: () => void;
  name: string;
}) {
  const t = useTranslations("checkout");
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
        checked ? "border-primary bg-primary/5" : "hover:bg-accent",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      {checked && (
        <Badge variant="info" className="ml-auto">
          {t("option.selected")}
        </Badge>
      )}
    </label>
  );
}
