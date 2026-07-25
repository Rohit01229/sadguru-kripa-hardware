"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  finalizeKachaAction,
  finalizePakkaAction,
  convertKachaAction,
  type KachaActionState,
  type PakkaActionState,
} from "./actions";
import { previewTotals, type PreviewLine } from "./preview";
import { InvoicePrint, KachaPrint, type StoreBranding, type LineLabelLookup } from "./print/Templates";
import { PosCustomerPicker } from "./PosCustomerPicker";
import type { InvoiceDTO, KachaEstimate } from "@hardware/core";
import {
  Button,
  Input,
  Label,
  Select,
  Checkbox,
  StateCodePicker,
  Badge,
  Card,
  Alert,
  EmptyState,
  SearchIcon,
  XIcon,
  toast,
  formatMoney,
} from "@hardware/ui";

export interface PosSaleUnit {
  id: string;
  unitCode: string;
  unitName: string;
  unitKind: "MEASURED" | "PIECE";
  factorToBase: string;
  salePrice: number; // paise
  mrp: number | null; // paise
  isDefault: boolean;
}
export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  gstRatePct: string;
  priceInclusive: boolean;
  hsnCode: string | null;
  baseUnitCode: string;
  availableBase: string;
  saleUnits: PosSaleUnit[];
}

/** A counter customer the POS can bill on khata (receivable posts to their ledger). */
export interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
}

/** The subset of the core ProductSummary DTO that /api/products returns and the POS
 *  needs. baseUnit is nested in the API DTO; the POS flattens it to baseUnitCode. */
interface ApiProductSummary {
  id: string;
  name: string;
  sku: string;
  gstRatePct: string;
  priceInclusive: boolean;
  hsnCode: string | null;
  baseUnit: { code: string };
  availableBase: string;
  saleUnits: PosSaleUnit[];
}

/** Project an /api/products row into the flat PosProduct the cart/preview/print use. */
function toPosProduct(p: ApiProductSummary): PosProduct {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    gstRatePct: p.gstRatePct,
    priceInclusive: p.priceInclusive,
    hsnCode: p.hsnCode,
    baseUnitCode: p.baseUnit.code,
    availableBase: p.availableBase,
    saleUnits: p.saleUnits.map((su) => ({
      id: su.id,
      unitCode: su.unitCode,
      unitName: su.unitName,
      unitKind: su.unitKind,
      factorToBase: su.factorToBase,
      salePrice: su.salePrice,
      mrp: su.mrp,
      isDefault: su.isDefault,
    })),
  };
}

interface CartLine {
  key: number;
  productId: string;
  saleUnitId: string;
  quantity: string;
  /** Manual rate override in rupees (string); empty = use catalog price. */
  rateOverride: string;
  /** Line discount in rupees (string). */
  lineDiscount: string;
}

type Mode = "KACHA" | "PAKKA";
type PaymentMode = "CASH" | "UPI" | "CARD" | "KHATA";
type PrintSize = "thermal2" | "thermal3" | "a5" | "a4";

const PAYMENT_MODES: PaymentMode[] = ["CASH", "UPI", "CARD", "KHATA"];

let keySeq = 1;

export function PosClient({
  products,
  mayReadCustomers = false,
  homeState,
  storeName,
  store,
  mayKacha,
  mayPakka,
}: {
  products: PosProduct[];
  /** When true, the khata customer picker (typeahead → /api/customers?q=) is shown. */
  mayReadCustomers?: boolean;
  homeState: string;
  storeName: string;
  /** Full print branding from StoreConfig (address/GSTIN/bank/terms). Falls back to
   *  storeName-only when absent so the receipt still renders. */
  store?: StoreBranding;
  mayKacha: boolean;
  mayPakka: boolean;
}) {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  const PAYMENT_LABEL: Record<PaymentMode, string> = {
    CASH: t("pos.paymentCash"),
    UPI: t("pos.paymentUpi"),
    CARD: t("pos.paymentCard"),
    KHATA: t("pos.paymentKhata"),
  };
  // The catalog the counter knows about. Seeded with the server's first page; products
  // found via the server-side search typeahead (/api/products?q=) are merged in here so
  // their sale-units / GST / labels are available to the cart, preview math, and print —
  // exactly as if they had been in the initial page. This is what lets the counter ring
  // up ANY product, not just the first 200.
  const [catalog, setCatalog] = useState<PosProduct[]>(products);
  useEffect(() => {
    // Re-seed from the server's first page when it changes, but PRESERVE any products
    // merged in via the /api/products?q= typeahead — a cart line may depend on one of them,
    // and dropping it would make the byId.get(...)! lookups below throw mid-bill (POS crash).
    // Union by id, prop wins for overlapping ids.
    setCatalog((cur) => {
      const ids = new Set(products.map((p) => p.id));
      const extras = cur.filter((p) => !ids.has(p.id));
      return extras.length ? [...products, ...extras] : products;
    });
  }, [products]);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const branding: StoreBranding = store ?? { name: storeName };

  const [mode, setMode] = useState<Mode>(mayPakka ? "PAKKA" : "KACHA");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [billDiscount, setBillDiscount] = useState("");
  const [roundOff, setRoundOff] = useState(true);
  const [placeOfSupply, setPlaceOfSupply] = useState(homeState);
  const [customerName, setCustomerName] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  /** Selected counter-customer (required for KHATA — the receivable posts here). null =
   *  walk-in. Resolved via the typeahead picker, not an eagerly-loaded directory. */
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const customerId = customer?.id ?? "";
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CASH");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [printSize, setPrintSize] = useState<PrintSize>("thermal3");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDTO | null>(null);
  const [estimate, setEstimate] = useState<(KachaEstimate & { items: { name: string; qty: string; unit: string }[] }) | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Readable line labels for the printed invoice (product — sale-unit name), derived
  // from the catalog already loaded for the counter. Display-only; falls back to the
  // raw id in the template when a product/unit isn't found.
  const invoiceLineLabels = useMemo<LineLabelLookup[]>(() => {
    if (!invoice) return [];
    return invoice.lines.map((l) => {
      const p = byId.get(l.productId);
      const su = p?.saleUnits.find((s) => s.id === l.saleUnitId);
      const unit = su?.unitName ?? su?.unitCode ?? "";
      const label = p ? (unit ? `${p.name} — ${unit}` : p.name) : l.productId.slice(0, 8);
      return { productId: l.productId, saleUnitId: l.saleUnitId, label };
    });
  }, [invoice, byId]);

  // ── Search results ──
  // Instant local matches over the first catalog page (name / SKU, case-insensitive)…
  const localResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [catalog, search]);

  // …plus server matches so the operator can ring up ANY product, not just the first
  // page. /api/products?q= (🌐 product read) returns the full POS DTO (sale units / GST /
  // hsn). The AbortController makes the latest keystroke win. Results are merged into the
  // catalog on pick so the cart/preview/print can resolve them.
  const [remoteResults, setRemoteResults] = useState<PosProduct[]>([]);
  useEffect(() => {
    const q = search.trim();
    if (q.length < 1) {
      setRemoteResults([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(q)}&limit=10`, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: ApiProductSummary[] };
        setRemoteResults((json.data ?? []).map(toPosProduct));
      } catch {
        if (!ctrl.signal.aborted) setRemoteResults([]);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [search]);

  // Merge local + remote, de-duplicate by id (local wins — it's already in the catalog),
  // cap at 8 for the dropdown.
  const results = useMemo(() => {
    if (!search.trim()) return [];
    const seen = new Set(localResults.map((p) => p.id));
    const merged = [...localResults];
    for (const p of remoteResults) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        merged.push(p);
      }
    }
    return merged.slice(0, 8);
  }, [localResults, remoteResults, search]);

  function addProduct(p: PosProduct) {
    const def = p.saleUnits.find((su) => su.isDefault) ?? p.saleUnits[0];
    if (!def) return;
    // Ensure the product is in the catalog so byId (cart/preview/print labels) can
    // resolve it — a server-search result is not in the seeded first page.
    setCatalog((cur) => (cur.some((c) => c.id === p.id) ? cur : [...cur, p]));
    setLines((ls) => [
      ...ls,
      { key: keySeq++, productId: p.id, saleUnitId: def.id, quantity: "1", rateOverride: "", lineDiscount: "" },
    ]);
    setSearch("");
    setRemoteResults([]);
    searchRef.current?.focus();
  }

  function patchLine(key: number, patch: Partial<CartLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  // Keyboard: Enter adds the top match, Escape clears the search box.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && results[0]) {
      e.preventDefault();
      addProduct(results[0]);
    } else if (e.key === "Escape" && search) {
      e.preventDefault();
      setSearch("");
    }
  }

  // ── Live preview (paise integer math; the server is authoritative) ──
  const previewLines: PreviewLine[] = lines.map((l) => {
    const p = byId.get(l.productId)!;
    const su = p.saleUnits.find((s) => s.id === l.saleUnitId) ?? p.saleUnits[0]!;
    const unitPricePaise =
      l.rateOverride.trim() !== "" ? Math.round(Number(l.rateOverride) * 100) : su.salePrice;
    return {
      unitPricePaise,
      qty: Number(l.quantity || "0"),
      gstRatePct: Number(p.gstRatePct),
      lineDiscountPaise: l.lineDiscount.trim() !== "" ? Math.round(Number(l.lineDiscount) * 100) : 0,
      priceInclusive: p.priceInclusive,
    };
  });
  const preview = previewTotals({
    lines: previewLines,
    supplyState: placeOfSupply,
    homeState,
    billDiscountPaise: billDiscount.trim() !== "" ? Math.round(Number(billDiscount) * 100) : 0,
    roundOff: mode === "PAKKA" && roundOff,
    taxed: mode === "PAKKA",
  });

  const changeDue =
    paymentMode === "CASH" && amountPaid.trim() !== ""
      ? Math.max(Math.round(Number(amountPaid) * 100) - preview.grandTotal, 0)
      : 0;

  function buildPakkaPayload(extra: Record<string, unknown> = {}) {
    const picked = customer;
    // For khata the receivable must attach to an existing Customer party (customerId);
    // for cash/UPI/card a free-text walk-in name/GSTIN snapshot is enough.
    const party =
      picked || customerName.trim() || customerGstin.trim()
        ? {
            customerId: picked?.id ?? null,
            name: picked?.name ?? (customerName.trim() || null),
            gstin: picked?.gstin ?? (customerGstin.trim() || null),
          }
        : null;
    return {
      placeOfSupplyState: placeOfSupply,
      customer: party,
      lines: lines.map((l) => ({
        productId: l.productId,
        saleUnitId: l.saleUnitId,
        quantity: l.quantity,
        rateOverride: l.rateOverride.trim() !== "" ? Math.round(Number(l.rateOverride) * 100) : null,
        lineDiscount: l.lineDiscount.trim() !== "" ? Math.round(Number(l.lineDiscount) * 100) : 0,
      })),
      billDiscount: billDiscount.trim() !== "" ? Math.round(Number(billDiscount) * 100) : 0,
      roundOff,
      payment: {
        mode: paymentMode,
        amountPaid: amountPaid.trim() !== "" ? Math.round(Number(amountPaid) * 100) : 0,
        reference: paymentRef.trim() || null,
      },
      ...extra,
    };
  }

  function reset() {
    setLines([]);
    setBillDiscount("");
    setCustomerName("");
    setCustomerGstin("");
    setCustomer(null);
    setAmountPaid("");
    setPaymentRef("");
  }

  async function onFinalizeKacha() {
    setBusy(true);
    setError(null);
    setInvoice(null);
    setEstimate(null);
    const items = lines.map((l) => {
      const p = byId.get(l.productId)!;
      const su = p.saleUnits.find((s) => s.id === l.saleUnitId)!;
      return { name: p.name, qty: l.quantity, unit: su.unitCode };
    });
    const res: KachaActionState = await finalizeKachaAction({
      lines: lines.map((l) => ({ productId: l.productId, saleUnitId: l.saleUnitId, quantity: l.quantity })),
    });
    setBusy(false);
    if (res.ok && res.estimate) {
      setEstimate({ ...res.estimate, items });
      toast.success(t("pos.toastKachaFinalized"), { description: t("pos.toastKachaFinalizedDesc") });
      reset();
    } else {
      const msg = res.error ?? t("pos.errorFinalizeKacha");
      setError(msg);
      toast.error(msg);
    }
  }

  async function onFinalizePakka() {
    setBusy(true);
    setError(null);
    setInvoice(null);
    setEstimate(null);
    const res: PakkaActionState = await finalizePakkaAction(buildPakkaPayload());
    setBusy(false);
    if (res.ok && res.invoice) {
      setInvoice(res.invoice);
      toast.success(t("pos.toastInvoiceCreated", { invoiceNo: res.invoice.invoiceNo }));
      reset();
    } else {
      const msg = res.error ?? t("pos.errorCreateInvoice");
      setError(msg);
      toast.error(msg);
    }
  }

  // Convert: the kacha cart was NOT separately decremented in this flow (we never
  // called /kacha/decrement), so stockAlreadyDecremented is false — the pakka path
  // decrements now. This is the one-click "ring it up properly" button.
  async function onConvert() {
    setBusy(true);
    setError(null);
    setInvoice(null);
    setEstimate(null);
    const res: PakkaActionState = await convertKachaAction(
      buildPakkaPayload({ stockAlreadyDecremented: false, stockMovementRefs: [] }),
    );
    setBusy(false);
    if (res.ok && res.invoice) {
      setInvoice(res.invoice);
      toast.success(t("pos.toastInvoiceCreated", { invoiceNo: res.invoice.invoiceNo }), {
        description: t("pos.toastConvertedDesc"),
      });
      reset();
    } else {
      const msg = res.error ?? t("pos.errorConvert");
      setError(msg);
      toast.error(msg);
    }
  }

  // Khata requires a saved customer to post the receivable against (the core service
  // enforces this too; this just gates the button cosmetically).
  const khataNeedsCustomer = mode === "PAKKA" && paymentMode === "KHATA" && !customerId;
  const canSubmit =
    lines.length > 0 && !busy && lines.every((l) => Number(l.quantity) > 0) && !khataNeedsCustomer;

  const toLedger = Math.max(
    preview.grandTotal - (amountPaid.trim() !== "" ? Math.round(Number(amountPaid) * 100) : 0),
    0,
  );

  // Primary action for the mobile sticky bar: mirrors the aside's main CTA so the
  // operator can ring up without scrolling to the totals panel.
  const primaryAction = mode === "KACHA" ? onFinalizeKacha : onFinalizePakka;
  const primaryLabel = mode === "KACHA" ? t("pos.finalizeKachaShort") : t("pos.createInvoiceShort");
  const primaryDisabled = mode === "KACHA" ? !canSubmit || !mayKacha : !canSubmit || !mayPakka;

  return (
    <div className="grid gap-6 pb-24 lg:grid-cols-[1fr_360px] lg:pb-0">
      {/* ── Cart column ── */}
      <section className="space-y-3">
        {/* Mode toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label={t("pos.billType")}
            className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm"
          >
            <button
              type="button"
              disabled={!mayPakka}
              aria-pressed={mode === "PAKKA"}
              onClick={() => setMode("PAKKA")}
              className={`rounded-md px-4 py-2 font-medium transition-colors disabled:opacity-40 sm:py-1 ${
                mode === "PAKKA" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("pos.modePakka")}
            </button>
            <button
              type="button"
              disabled={!mayKacha}
              aria-pressed={mode === "KACHA"}
              onClick={() => setMode("KACHA")}
              className={`rounded-md px-4 py-2 font-medium transition-colors disabled:opacity-40 sm:py-1 ${
                mode === "KACHA" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("pos.modeKacha")}
            </button>
          </div>
          {mode === "KACHA" && (
            <span className="text-xs text-muted-foreground">{t("pos.kachaHint")}</span>
          )}
        </div>

        {/* Search / add */}
        <div className="relative">
          <Label htmlFor="pos-search" className="sr-only">
            {t("pos.searchLabel")}
          </Label>
          <SearchIcon
            width={16}
            height={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="pos-search"
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t("pos.searchPlaceholder")}
            className="h-11 pl-9 sm:h-9"
            autoComplete="off"
            aria-expanded={results.length > 0}
            role="combobox"
            aria-controls="pos-search-results"
          />
          {results.length > 0 && (
            <ul
              id="pos-search-results"
              role="listbox"
              className="absolute z-20 mt-1 max-h-72 w-full divide-y overflow-y-auto rounded-md border bg-card shadow-md"
            >
              {results.map((p, i) => (
                <li key={p.id} role="option" aria-selected={i === 0}>
                  <button
                    type="button"
                    onClick={() => addProduct(p)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:min-h-0"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{p.name}</span>{" "}
                      <span className="text-xs text-muted-foreground">{p.sku}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {t("pos.available", { qty: p.availableBase, unit: p.baseUnitCode })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Lines */}
        {lines.length === 0 ? (
          <EmptyState
            className="py-12"
            icon={<SearchIcon width={28} height={28} />}
            title={t("pos.emptyCartTitle")}
            description={t("pos.emptyCartDescription")}
          />
        ) : (
          <>
            {/* Mobile (<md): one stacked card per line. Large (h-11 / 44px) touch
                targets so qty/rate/disc are tappable on a phone; no horizontal scroll. */}
            <ul className="space-y-3 md:hidden">
              {lines.map((l, i) => {
                const p = byId.get(l.productId)!;
                const su = p.saleUnits.find((s) => s.id === l.saleUnitId) ?? p.saleUnits[0]!;
                const lineGross = previewLines[i]
                  ? previewLines[i]!.unitPricePaise * previewLines[i]!.qty
                  : 0;
                return (
                  <li key={l.key} className="rounded-lg border bg-card p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.sku}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLine(l.key)}
                        aria-label={t("pos.removeNamed", { name: p.name })}
                      >
                        <XIcon width={18} height={18} />
                      </Button>
                    </div>
                    <div className="mt-2">
                      <Label htmlFor={`m-unit-${l.key}`} className="text-xs text-muted-foreground">
                        {t("pos.colUnit")}
                      </Label>
                      <Select
                        id={`m-unit-${l.key}`}
                        aria-label={t("pos.saleUnitFor", { name: p.name })}
                        value={l.saleUnitId}
                        onChange={(e) => patchLine(l.key, { saleUnitId: e.target.value })}
                        className="mt-1 h-11"
                      >
                        {p.saleUnits.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.unitName} ({formatMoney(s.salePrice)})
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <Label htmlFor={`m-qty-${l.key}`} className="text-xs text-muted-foreground">
                          {t("pos.colQty")}
                        </Label>
                        <Input
                          id={`m-qty-${l.key}`}
                          aria-label={t("pos.quantityFor", { name: p.name })}
                          value={l.quantity}
                          onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                          inputMode="decimal"
                          aria-invalid={Number(l.quantity) > 0 ? undefined : true}
                          className="mt-1 h-11 text-right tabular-nums"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`m-rate-${l.key}`} className="text-xs text-muted-foreground">
                          {t("pos.colRate")}
                        </Label>
                        <Input
                          id={`m-rate-${l.key}`}
                          aria-label={t("pos.rateOverrideFor", { name: p.name })}
                          value={l.rateOverride}
                          onChange={(e) => patchLine(l.key, { rateOverride: e.target.value })}
                          placeholder={(su.salePrice / 100).toFixed(2)}
                          inputMode="decimal"
                          className="mt-1 h-11 text-right tabular-nums"
                          title={t("pos.rateOverrideTitle")}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`m-disc-${l.key}`} className="text-xs text-muted-foreground">
                          {t("pos.colDisc")}
                        </Label>
                        <Input
                          id={`m-disc-${l.key}`}
                          aria-label={t("pos.lineDiscountFor", { name: p.name })}
                          value={l.lineDiscount}
                          onChange={(e) => patchLine(l.key, { lineDiscount: e.target.value })}
                          placeholder="0"
                          inputMode="decimal"
                          className="mt-1 h-11 text-right tabular-nums"
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
                      <span className="text-muted-foreground">{t("pos.colAmount")}</span>
                      <span className="font-medium tabular-nums">{formatMoney(lineGross)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop (>=md): dense data-entry table. */}
            <div className="hidden overflow-x-auto rounded-lg border md:block">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="h-9 px-3 font-medium">{t("pos.colItem")}</th>
                    <th className="h-9 px-3 font-medium">{t("pos.colUnit")}</th>
                    <th className="h-9 px-3 font-medium text-right">{t("pos.colQty")}</th>
                    <th className="h-9 px-3 font-medium text-right">{t("pos.colRate")}</th>
                    <th className="h-9 px-3 font-medium text-right">{t("pos.colDisc")}</th>
                    <th className="h-9 px-3 font-medium text-right">{t("pos.colAmount")}</th>
                    <th className="h-9 w-9 px-2">
                      <span className="sr-only">{t("pos.colRemove")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {lines.map((l, i) => {
                    const p = byId.get(l.productId)!;
                    const su = p.saleUnits.find((s) => s.id === l.saleUnitId) ?? p.saleUnits[0]!;
                    const lineGross = previewLines[i]
                      ? previewLines[i]!.unitPricePaise * previewLines[i]!.qty
                      : 0;
                    return (
                      <tr key={l.key} className="border-b align-top transition-colors hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.sku}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            aria-label={t("pos.saleUnitFor", { name: p.name })}
                            value={l.saleUnitId}
                            onChange={(e) => patchLine(l.key, { saleUnitId: e.target.value })}
                            className="h-8 w-auto min-w-[8rem] text-xs"
                          >
                            {p.saleUnits.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.unitName} ({formatMoney(s.salePrice)})
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            aria-label={t("pos.quantityFor", { name: p.name })}
                            value={l.quantity}
                            onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                            inputMode="decimal"
                            aria-invalid={Number(l.quantity) > 0 ? undefined : true}
                            className="ml-auto h-8 w-20 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            aria-label={t("pos.rateOverrideFor", { name: p.name })}
                            value={l.rateOverride}
                            onChange={(e) => patchLine(l.key, { rateOverride: e.target.value })}
                            placeholder={(su.salePrice / 100).toFixed(2)}
                            inputMode="decimal"
                            className="ml-auto h-8 w-24 text-right tabular-nums"
                            title={t("pos.rateOverrideTitle")}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            aria-label={t("pos.lineDiscountFor", { name: p.name })}
                            value={l.lineDiscount}
                            onChange={(e) => patchLine(l.key, { lineDiscount: e.target.value })}
                            placeholder="0"
                            inputMode="decimal"
                            className="ml-auto h-8 w-24 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(lineGross)}</td>
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeLine(l.key)}
                            aria-label={t("pos.removeNamed", { name: p.name })}
                          >
                            <XIcon width={16} height={16} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── Totals / payment column ── */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card className="space-y-3 p-4 text-sm">
          {/* Bill-level controls */}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="bill-discount">{t("pos.billDiscount")}</Label>
            <Input
              id="bill-discount"
              value={billDiscount}
              onChange={(e) => setBillDiscount(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="h-8 w-28 text-right tabular-nums"
            />
          </div>

          {mode === "PAKKA" && (
            <>
              <label className="flex cursor-pointer items-center justify-between gap-2">
                <span className="font-medium">{t("pos.roundOff")}</span>
                <Checkbox
                  checked={roundOff}
                  onChange={(e) => setRoundOff(e.target.checked)}
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="place-of-supply">{t("pos.placeOfSupply")}</Label>
                <StateCodePicker
                  id="place-of-supply"
                  value={placeOfSupply}
                  onChange={(e) => setPlaceOfSupply(e.target.value)}
                  className="h-8 w-44 text-xs"
                />
              </div>
              <div className="space-y-2 border-t pt-3">
                {mayReadCustomers && (
                  <PosCustomerPicker value={customer} onSelect={setCustomer} />
                )}
                {!customerId && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="pos-customer-name">{t("pos.customerName")}</Label>
                      <Input
                        id="pos-customer-name"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder={t("pos.customerNamePlaceholder")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pos-customer-gstin">{t("pos.customerGstin")}</Label>
                      <Input
                        id="pos-customer-gstin"
                        value={customerGstin}
                        onChange={(e) => setCustomerGstin(e.target.value)}
                        placeholder={t("pos.customerGstinPlaceholder")}
                        className="uppercase"
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Totals */}
          <div className="space-y-1 border-t pt-3 tabular-nums">
            <Row label={t("pos.totalTaxable")} value={preview.taxableTotal} />
            {preview.discountTotal > 0 && <Row label={t("pos.totalDiscount")} value={-preview.discountTotal} />}
            {mode === "PAKKA" && preview.taxKind === "CGST_SGST" && (
              <>
                <Row label={t("pos.totalCgst")} value={preview.cgstTotal} />
                <Row label={t("pos.totalSgst")} value={preview.sgstTotal} />
              </>
            )}
            {mode === "PAKKA" && preview.taxKind === "IGST" && <Row label={t("pos.totalIgst")} value={preview.igstTotal} />}
            {mode === "PAKKA" && roundOff && preview.roundOff !== 0 && (
              <Row label={t("pos.totalRoundOff")} value={preview.roundOff} />
            )}
            <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
              <span>{mode === "KACHA" ? t("pos.estimateTotal") : t("pos.grandTotal")}</span>
              <span>{formatMoney(preview.grandTotal)}</span>
            </div>
          </div>

          {/* Payment panel (pakka) */}
          {mode === "PAKKA" && (
            <div className="space-y-2 border-t pt-3">
              <div role="group" aria-label={t("pos.paymentMode")} className="grid grid-cols-4 gap-1">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={paymentMode === m}
                    onClick={() => setPaymentMode(m)}
                    className={`flex h-11 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 ${
                      paymentMode === m
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {PAYMENT_LABEL[m]}
                  </button>
                ))}
              </div>
              {paymentMode === "KHATA" && (
                <div className="space-y-2">
                  {!customerId ? (
                    <Alert
                      variant="warning"
                      className="gap-2 px-2.5 py-1.5 text-xs"
                      icon={null}
                      description={t("pos.khataNoCustomer")}
                    />
                  ) : (
                    <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                      {t("pos.khataBilling", { name: customer?.name ?? "" })}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="khata-part">{t("pos.partPayment")}</Label>
                    <Input
                      id="khata-part"
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="h-8 w-28 text-right tabular-nums"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                    <span>{t("pos.toLedger")}</span>
                    <span>{formatMoney(toLedger)}</span>
                  </div>
                </div>
              )}
              {paymentMode !== "KHATA" && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="amount-received">{t("pos.amountReceived")}</Label>
                    <Input
                      id="amount-received"
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      placeholder={(preview.grandTotal / 100).toFixed(2)}
                      inputMode="decimal"
                      className="h-8 w-28 text-right tabular-nums"
                    />
                  </div>
                  {paymentMode === "CASH" && changeDue > 0 && (
                    <div className="flex justify-between text-xs font-medium tabular-nums text-success">
                      <span>{t("pos.changeDue")}</span>
                      <span>{formatMoney(changeDue)}</span>
                    </div>
                  )}
                  {(paymentMode === "UPI" || paymentMode === "CARD") && (
                    <div className="space-y-1">
                      <Label htmlFor="payment-ref" className="sr-only">
                        {t("pos.txnReferenceLabel")}
                      </Label>
                      <Input
                        id="payment-ref"
                        value={paymentRef}
                        onChange={(e) => setPaymentRef(e.target.value)}
                        placeholder={t("pos.txnReferencePlaceholder")}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="space-y-2 border-t pt-3">
            {mode === "KACHA" ? (
              <>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!canSubmit || !mayKacha}
                  isLoading={busy}
                  onClick={onFinalizeKacha}
                >
                  {t("pos.finalizeKacha")}
                </Button>
                {mayPakka && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!canSubmit || busy}
                    onClick={onConvert}
                  >
                    {t("pos.convertToPakka")}
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                className="w-full"
                disabled={!canSubmit || !mayPakka}
                isLoading={busy}
                onClick={onFinalizePakka}
              >
                {t("pos.createPakkaInvoice")}
              </Button>
            )}
            {khataNeedsCustomer && (
              <p className="text-center text-xs text-muted-foreground">
                {t("pos.khataNeedsCustomer")}
              </p>
            )}
          </div>

          {/* Print size selector */}
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
            <Label htmlFor="pos-print-size" className="text-xs">
              {t("pos.printSize")}
            </Label>
            <Select
              id="pos-print-size"
              value={printSize}
              onChange={(e) => setPrintSize(e.target.value as PrintSize)}
              className="h-8 w-32 text-xs"
            >
              <option value="thermal2">Thermal 2&quot;</option>
              <option value="thermal3">Thermal 3&quot;</option>
              <option value="a5">A5</option>
              <option value="a4">A4</option>
            </Select>
          </div>
        </Card>
      </aside>

      {/* ── Sticky pay bar (mobile / tablet only) ──
          The aside's totals panel scrolls away on a phone, so this fixed bar keeps the
          live grand total and the primary action thumb-reachable. Hidden on >=lg where
          the aside is already sticky. Only shown once the bill has lines. */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">
                {mode === "KACHA" ? t("pos.estimateTotal") : t("pos.grandTotal")}
              </div>
              <div className="truncate text-lg font-semibold tabular-nums">
                {formatMoney(preview.grandTotal)}
              </div>
            </div>
            <Button
              type="button"
              size="lg"
              className="h-12 shrink-0 px-6"
              disabled={primaryDisabled}
              isLoading={busy}
              onClick={primaryAction}
            >
              {primaryLabel}
            </Button>
          </div>
          {khataNeedsCustomer && (
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {t("pos.khataNeedsCustomer")}
            </p>
          )}
        </div>
      )}

      {/* ── Receipt / invoice result ── */}
      {invoice && (
        <div className="lg:col-span-2">
          <Card className="mb-3 flex flex-wrap items-center justify-between gap-3 border-success/30 bg-success/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="success">{t("pos.invoiceCreated")}</Badge>
              <span>
                <strong>{invoice.invoiceNo}</strong>
                {invoice.convertedFromKacha ? t("pos.convertedFromKachaSuffix") : ""}.
                {invoice.changeDue > 0 ? t("pos.changeDueSuffix", { amount: formatMoney(invoice.changeDue) }) : ""}
                {invoice.balanceToLedger > 0
                  ? t("pos.postedToKhataSuffix", { amount: formatMoney(invoice.balanceToLedger) })
                  : ""}
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
              {tCommon("actions.print")}
            </Button>
          </Card>
          <InvoicePrint invoice={invoice} store={branding} size={printSize} lineLabels={invoiceLineLabels} />
        </div>
      )}
      {estimate && (
        <div className="lg:col-span-2">
          <Card className="mb-3 flex flex-wrap items-center justify-between gap-3 border-success/30 bg-success/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="success">{t("pos.kachaFinalizedBadge")}</Badge>
              <span>{t("pos.kachaFinalizedNote")}</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
              {t("pos.printEstimate")}
            </Button>
          </Card>
          <KachaPrint estimate={estimate} store={branding} size={printSize} />
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{formatMoney(value)}</span>
    </div>
  );
}
