"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormField,
  Input,
  Label,
  Select,
  StateCodePicker,
  Textarea,
  SearchIcon,
  XIcon,
  toast,
  formatMoney,
} from "@hardware/ui";
import type { SalesDocDTO, SalesDocKind } from "@hardware/core";
import { PosCustomerPicker } from "../billing/PosCustomerPicker";
import { quickCreateItemAction } from "../billing/actions";
import type { PosCustomer, PosProduct } from "../billing/PosClient";
import { previewTotals, type PreviewLine } from "../billing/preview";
import { createSalesDocAction, updateSalesDocAction } from "./actions";

/**
 * The one form behind Estimate, Proforma invoice and Delivery challan — myBillBook
 * uses the same screen for all three, and so does this: party at the top, an item
 * search that adds rows, a running total on the right.
 *
 * It is deliberately the POS's model with a different frame. Same typeahead over
 * /api/products, same customer picker, same client-side `previewTotals` mirror of the
 * server's tax engine. What a shopkeeper learns at the counter transfers here without
 * being re-taught, and the number on the quote is the number on the bill.
 */

interface FormLine {
  key: number;
  productId: string;
  saleUnitId: string;
  quantity: string;
  /** Rate in RUPEES as typed. Empty = use the catalog price. */
  rate: string;
  /** Line discount in RUPEES as typed. */
  discount: string;
}

let keySeq = 1;

/** Copy shown per document kind — the labels a myBillBook user already knows. */
const COPY: Record<
  SalesDocKind,
  { label: string; listHref: string; partyLabel: string; hint: string; cta: string }
> = {
  QUOTATION: {
    label: "Estimate",
    listHref: "/sales/estimates",
    partyLabel: "Estimate for",
    hint: "A price offer. Nothing is billed and no stock moves until you convert it to a bill.",
    cta: "Save estimate",
  },
  PROFORMA: {
    label: "Proforma invoice",
    listHref: "/sales/proforma",
    partyLabel: "Proforma for",
    hint: "Send this to ask for payment in advance. It is not a tax invoice and claims no GST.",
    cta: "Save proforma",
  },
  DELIVERY_CHALLAN: {
    label: "Delivery challan",
    listHref: "/sales/challans",
    partyLabel: "Deliver to",
    hint: "Send goods now, bill later. Stock is reduced when you convert this to a bill — not now.",
    cta: "Save challan",
  },
};

function toApiProduct(p: {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  gstRatePct: string;
  priceInclusive: boolean;
  hsnCode: string | null;
  baseUnit: { code: string };
  availableBase: string;
  saleUnits: PosProduct["saleUnits"];
}): PosProduct {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    gstRatePct: p.gstRatePct,
    priceInclusive: p.priceInclusive,
    hsnCode: p.hsnCode,
    baseUnitCode: p.baseUnit.code,
    availableBase: p.availableBase,
    saleUnits: p.saleUnits,
  };
}

export function SalesDocForm({
  kind,
  products,
  homeState,
  existing,
}: {
  kind: SalesDocKind;
  /** First catalog page, for instant local matches. Search also hits /api/products. */
  products: PosProduct[];
  homeState: string;
  /** Present when revising an existing open document. */
  existing?: SalesDocDTO;
}) {
  const router = useRouter();
  const copy = COPY[kind];
  const isEdit = existing != null;

  const [catalog, setCatalog] = useState<PosProduct[]>(products);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  const [customer, setCustomer] = useState<PosCustomer | null>(
    existing?.customerId
      ? {
          id: existing.customerId,
          name: existing.customerName ?? "",
          phone: existing.customerPhone,
          gstin: existing.customerGstin,
        }
      : null,
  );
  /** Free-typed party name for a walk-in with no saved record. */
  const [walkInName, setWalkInName] = useState(
    existing && !existing.customerId ? (existing.customerName ?? "") : "",
  );
  const [placeOfSupply, setPlaceOfSupply] = useState(existing?.placeOfSupplyState ?? homeState);
  const [validUntil, setValidUntil] = useState(existing?.validUntil?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [billDiscount, setBillDiscount] = useState(
    existing && existing.discountTotal > 0 ? "" : "",
  );
  const [roundOff, setRoundOff] = useState(true);

  const [lines, setLines] = useState<FormLine[]>(
    existing
      ? existing.lines.map((l) => ({
          key: keySeq++,
          productId: l.productId,
          saleUnitId: l.saleUnitId,
          quantity: l.saleQty,
          rate: (l.unitPrice / 100).toFixed(2),
          discount: l.lineDiscount > 0 ? (l.lineDiscount / 100).toFixed(2) : "",
        }))
      : [],
  );

  const [search, setSearch] = useState("");
  const [remote, setRemote] = useState<PosProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Quick-add an item that is not in the catalog yet (19 §6) — the same escape hatch
  // the counter has, so writing a quote never dead-ends on a missing item.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);

  // Products the edited document references may sit outside the first catalog page.
  // Fetch them once so their names, units and rates resolve instead of rendering ids.
  useEffect(() => {
    if (!existing) return;
    const missing = existing.lines.map((l) => l.productId).filter((id) => !byId.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched: PosProduct[] = [];
      for (const id of [...new Set(missing)]) {
        try {
          const res = await fetch(`/api/products/${id}`, { headers: { Accept: "application/json" } });
          if (!res.ok) continue;
          // This route returns the product DTO directly, not wrapped in { data }.
          const dto = (await res.json()) as Parameters<typeof toApiProduct>[0];
          if (dto?.id) fetched.push(toApiProduct(dto));
        } catch {
          /* a product we cannot resolve renders as its id; the document still saves */
        }
      }
      if (!cancelled && fetched.length) {
        setCatalog((cur) => [...cur, ...fetched.filter((f) => !cur.some((c) => c.id === f.id))]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once for the loaded document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  // ── Item search (local page first, then the server so ANY item is reachable) ──
  const localResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode !== null && p.barcode.toLowerCase() === q),
    );
  }, [catalog, search]);

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setRemote([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(q)}&limit=10`, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { data?: Parameters<typeof toApiProduct>[0][] };
        setRemote((json.data ?? []).map(toApiProduct));
      } catch {
        if (!ctrl.signal.aborted) setRemote([]);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [search]);

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const seen = new Set(localResults.map((p) => p.id));
    return [...localResults, ...remote.filter((p) => !seen.has(p.id))].slice(0, 8);
  }, [localResults, remote, search]);

  function addProduct(p: PosProduct) {
    setCatalog((cur) => (cur.some((c) => c.id === p.id) ? cur : [...cur, p]));
    const su = p.saleUnits.find((s) => s.isDefault) ?? p.saleUnits[0];
    if (!su) {
      setError(`"${p.name}" has no sale unit set up yet.`);
      return;
    }
    setLines((cur) => {
      // Same item + unit already on the document → bump the quantity, the way a till
      // does. A row whose rate was overridden is bespoke and is left alone.
      const i = cur.findIndex(
        (l) => l.productId === p.id && l.saleUnitId === su.id && l.rate === "" && l.discount === "",
      );
      if (i >= 0) {
        const next = [...cur];
        next[i] = { ...next[i]!, quantity: String(Number(next[i]!.quantity) + 1) };
        return next;
      }
      return [
        ...cur,
        { key: keySeq++, productId: p.id, saleUnitId: su.id, quantity: "1", rate: "", discount: "" },
      ];
    });
    setSearch("");
    setError(null);
    searchRef.current?.focus();
  }

  async function quickAddItem() {
    const name = quickName.trim() || search.trim();
    if (!name) return;
    setQuickBusy(true);
    const res = await quickCreateItemAction(name, quickPrice || "0", "18");
    setQuickBusy(false);
    if (res.product) {
      addProduct(res.product as unknown as PosProduct);
      setQuickOpen(false);
      setQuickName("");
      setQuickPrice("");
      toast.success(`"${res.product.name}" added to your items`);
    } else {
      toast.error(res.error ?? "Could not create the item.");
    }
  }

  function updateLine(key: number, patch: Partial<FormLine>) {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: number) {
    setLines((cur) => cur.filter((l) => l.key !== key));
  }

  /** Effective per-unit rate in paise: what was typed, else the catalog price. */
  function ratePaise(l: FormLine): number {
    if (l.rate.trim() !== "") return Math.round(Number(l.rate) * 100);
    const su = byId.get(l.productId)?.saleUnits.find((s) => s.id === l.saleUnitId);
    return su?.salePrice ?? 0;
  }

  const preview = useMemo(() => {
    const previewLines: PreviewLine[] = lines.map((l) => {
      const p = byId.get(l.productId);
      return {
        unitPricePaise: ratePaise(l),
        qty: Number(l.quantity) || 0,
        gstRatePct: Number(p?.gstRatePct ?? "0"),
        lineDiscountPaise: l.discount.trim() !== "" ? Math.round(Number(l.discount) * 100) : 0,
        priceInclusive: p?.priceInclusive ?? false,
      };
    });
    return previewTotals({
      lines: previewLines,
      supplyState: placeOfSupply,
      homeState,
      billDiscountPaise: billDiscount.trim() !== "" ? Math.round(Number(billDiscount) * 100) : 0,
      roundOff,
      taxed: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, byId, placeOfSupply, homeState, billDiscount, roundOff]);

  const partyName = customer?.name ?? walkInName.trim();
  const canSave = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0) && !busy;

  async function save() {
    setBusy(true);
    setError(null);

    const payload = {
      placeOfSupplyState: placeOfSupply,
      customer: {
        customerId: customer?.id ?? null,
        name: partyName || null,
        phone: customer?.phone ?? null,
        gstin: customer?.gstin ?? null,
      },
      lines: lines.map((l) => ({
        productId: l.productId,
        saleUnitId: l.saleUnitId,
        quantity: l.quantity,
        rateOverride: l.rate.trim() !== "" ? Math.round(Number(l.rate) * 100) : null,
        lineDiscount: l.discount.trim() !== "" ? Math.round(Number(l.discount) * 100) : 0,
      })),
      billDiscount: billDiscount.trim() !== "" ? Math.round(Number(billDiscount) * 100) : 0,
      roundOff,
      validUntil: kind === "QUOTATION" && validUntil ? new Date(validUntil).toISOString() : null,
      notes: notes.trim() || null,
    };

    const res = isEdit
      ? await updateSalesDocAction({ ...payload, id: existing!.id })
      : await createSalesDocAction({ ...payload, kind });

    setBusy(false);
    if (res.ok && res.doc) {
      toast.success(`${copy.label} ${res.doc.docNo} saved`);
      router.push(`${copy.listHref}/${res.doc.id}`);
      router.refresh();
    } else {
      const msg = res.error ?? "Could not save. Please try again.";
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}

        {/* ── Party + dates ── */}
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>{copy.partyLabel}</Label>
              <div className="mt-1.5">
                <PosCustomerPicker value={customer} onSelect={setCustomer} />
              </div>
              {!customer && (
                <div className="mt-2">
                  <Input
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    placeholder="…or just type a name for a walk-in"
                  />
                </div>
              )}
            </div>

            {kind === "QUOTATION" && (
              <FormField label="Valid till" hint="Leave blank for no expiry.">
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </FormField>
            )}
            <FormField label="Place of supply" hint="Decides CGST+SGST or IGST.">
              <StateCodePicker
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* ── Items ── */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="relative">
              <Label htmlFor="salesdoc-search">Add items</Label>
              <div className="relative mt-1.5">
                <SearchIcon
                  width={16}
                  height={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="salesdoc-search"
                  ref={searchRef}
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && results[0]) {
                      e.preventDefault();
                      addProduct(results[0]);
                    }
                  }}
                  placeholder="Search by item name, item code or barcode"
                  autoComplete="off"
                />
              </div>
              {search.trim() && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-lg">
                  {results.map((p) => {
                    const su = p.saleUnits.find((s) => s.isDefault) ?? p.saleUnits[0];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{p.sku}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {su ? formatMoney(su.salePrice) : "—"}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setQuickName(search.trim());
                      setQuickOpen(true);
                    }}
                    className="w-full border-t px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                  >
                    Add &ldquo;{search.trim()}&rdquo; as a new item
                  </button>
                </div>
              )}
            </div>

            {quickOpen && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
                  <FormField label="Item Name" required>
                    <Input value={quickName} onChange={(e) => setQuickName(e.target.value)} autoFocus />
                  </FormField>
                  <FormField label="Selling Price">
                    <Input
                      value={quickPrice}
                      onChange={(e) => setQuickPrice(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </FormField>
                  <div className="flex items-end gap-2">
                    <Button size="sm" onClick={quickAddItem} disabled={quickBusy}>
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setQuickOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No items yet. Search above to add the first one.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left font-medium">Item</th>
                      <th className="py-2 text-right font-medium">Qty</th>
                      <th className="py-2 text-left font-medium">Unit</th>
                      <th className="py-2 text-right font-medium">Rate</th>
                      <th className="py-2 text-right font-medium">Discount</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const p = byId.get(l.productId);
                      const amount = Math.max(
                        Math.round(ratePaise(l) * (Number(l.quantity) || 0)) -
                          (l.discount.trim() !== "" ? Math.round(Number(l.discount) * 100) : 0),
                        0,
                      );
                      return (
                        <tr key={l.key} className="border-b last:border-0">
                          <td className="py-2 pr-2">
                            <div className="font-medium">{p?.name ?? l.productId.slice(0, 8)}</div>
                            {p && (
                              <div className="text-xs text-muted-foreground">
                                {p.sku} · GST {p.gstRatePct}%
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              className="w-20 text-right"
                              value={l.quantity}
                              inputMode="decimal"
                              onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                              aria-label="Quantity"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <Select
                              value={l.saleUnitId}
                              onChange={(e) => updateLine(l.key, { saleUnitId: e.target.value })}
                              aria-label="Unit"
                            >
                              {(p?.saleUnits ?? []).map((su) => (
                                <option key={su.id} value={su.id}>
                                  {su.unitName || su.unitCode}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              className="w-24 text-right"
                              value={l.rate}
                              inputMode="decimal"
                              placeholder={(ratePaise(l) / 100).toFixed(2)}
                              onChange={(e) => updateLine(l.key, { rate: e.target.value })}
                              aria-label="Rate"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              className="w-24 text-right"
                              value={l.discount}
                              inputMode="decimal"
                              placeholder="0.00"
                              onChange={(e) => updateLine(l.key, { discount: e.target.value })}
                              aria-label="Discount"
                            />
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(amount)}</td>
                          <td className="py-2 text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeLine(l.key)}
                              aria-label="Remove item"
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
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <FormField label="Notes" hint="Printed at the bottom — delivery terms, site name, anything.">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </FormField>
          </CardContent>
        </Card>
      </section>

      {/* ── Totals ── */}
      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-xs text-muted-foreground">{copy.hint}</p>

            <FormField label="Discount on total (₹)">
              <Input
                value={billDiscount}
                onChange={(e) => setBillDiscount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </FormField>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} />
              Round off to the nearest rupee
            </label>

            <dl className="space-y-1.5 border-t pt-3 text-sm">
              <Row k="Taxable" v={formatMoney(preview.taxableTotal)} />
              {preview.discountTotal > 0 && (
                <Row k="Discount" v={`− ${formatMoney(preview.discountTotal)}`} />
              )}
              {preview.taxKind === "CGST_SGST" ? (
                <>
                  <Row k="CGST" v={formatMoney(preview.cgstTotal)} />
                  <Row k="SGST" v={formatMoney(preview.sgstTotal)} />
                </>
              ) : (
                <Row k="IGST" v={formatMoney(preview.igstTotal)} />
              )}
              {preview.roundOff !== 0 && <Row k="Round off" v={formatMoney(preview.roundOff)} />}
              <div className="flex items-baseline justify-between border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(preview.grandTotal)}</dd>
              </div>
            </dl>

            <Button className="w-full" onClick={save} disabled={!canSave}>
              {busy ? "Saving…" : isEdit ? "Save changes" : copy.cta}
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href={isEdit ? `${copy.listHref}/${existing!.id}` : copy.listHref}>Cancel</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-xs text-muted-foreground">
            <Badge variant="outline">Not a tax invoice</Badge>
            <p className="mt-2">
              No GST is charged and no stock moves on this document. Convert it to a bill when the
              sale actually happens.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
