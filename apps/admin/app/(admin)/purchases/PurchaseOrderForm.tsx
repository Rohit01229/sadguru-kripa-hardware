"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Select,
  Textarea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  XIcon,
  formatMoney,
  toast,
} from "@hardware/ui";
import type { PurchaseOrderDTO } from "@hardware/core";
import { createPurchaseOrderAction, updatePurchaseOrderAction } from "./actions";

/**
 * Write a purchase order. The buying-side twin of SalesDocForm — supplier at the top,
 * item rows, a running total — so the two directions feel like one app.
 *
 * There is no GST here on purpose: a goods receipt records cost only, so a tax figure
 * typed on an order would disappear when the goods arrive (21c).
 */

export interface PoProduct {
  id: string;
  name: string;
  sku: string;
  /** Cost the catalog last knew, in paise — pre-fills the rate. */
  costPerBaseUnit: number;
  saleUnits: { id: string; label: string; factorToBase: string }[];
}

interface FormLine {
  key: number;
  productId: string;
  receiveUnitId: string;
  quantity: string;
  /** Rate per receive unit in RUPEES, as typed. */
  cost: string;
}

let keySeq = 1;

/** Today as yyyy-mm-dd in LOCAL time (a UTC ISO slice would shift an evening entry). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PurchaseOrderForm({
  products,
  suppliers,
  existing,
}: {
  products: PoProduct[];
  suppliers: { id: string; name: string }[];
  existing?: PurchaseOrderDTO;
}) {
  const router = useRouter();
  const isEdit = existing != null;

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [supplierId, setSupplierId] = useState(existing?.supplierId ?? "");
  const [date, setDate] = useState(existing?.date.slice(0, 10) ?? todayIso());
  const [expectedDate, setExpectedDate] = useState(existing?.expectedDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const [lines, setLines] = useState<FormLine[]>(
    existing
      ? existing.lines.map((l) => ({
          key: keySeq++,
          productId: l.productId,
          receiveUnitId: l.receiveUnitId,
          quantity: l.quantity,
          cost: (l.costPerUnit / 100).toFixed(2),
        }))
      : [],
  );

  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addProduct(productId: string) {
    const p = byId.get(productId);
    if (!p) return;
    const su = p.saleUnits[0];
    if (!su) {
      setError(`"${p.name}" has no unit set up yet.`);
      return;
    }
    setLines((cur) => [
      ...cur,
      {
        key: keySeq++,
        productId,
        receiveUnitId: su.id,
        quantity: "1",
        // Seed the rate from what this item last cost, converted to the ordered unit.
        // A purchase rate is usually the same as last time; a blank field is not.
        cost: ((p.costPerBaseUnit * Number(su.factorToBase || "1")) / 100).toFixed(2),
      },
    ]);
    setPick("");
    setError(null);
  }

  function updateLine(key: number, patch: Partial<FormLine>) {
    setLines((cur) =>
      cur.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // Changing the unit changes what the rate means, so re-derive it from cost per
        // base unit rather than leaving a number that now says something else.
        if (patch.receiveUnitId && patch.receiveUnitId !== l.receiveUnitId) {
          const p = byId.get(l.productId);
          const su = p?.saleUnits.find((s) => s.id === patch.receiveUnitId);
          if (p && su) {
            next.cost = ((p.costPerBaseUnit * Number(su.factorToBase || "1")) / 100).toFixed(2);
          }
        }
        return next;
      }),
    );
  }

  const removeLine = (key: number) => setLines((cur) => cur.filter((l) => l.key !== key));

  const lineAmount = (l: FormLine) => {
    const qty = Number(l.quantity);
    const cost = Number(l.cost);
    if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0) return 0;
    return Math.round(qty * cost * 100);
  };
  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l), 0);

  const canSave =
    supplierId !== "" && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0) && !busy;

  async function save() {
    if (!supplierId) {
      setError("Choose a supplier.");
      return;
    }
    setBusy(true);
    setError(null);

    const payload = {
      supplierId,
      date: date ? new Date(date).toISOString() : null,
      expectedDate: expectedDate ? new Date(expectedDate).toISOString() : null,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({
        productId: l.productId,
        receiveUnitId: l.receiveUnitId,
        quantity: l.quantity,
        costPerUnit: l.cost.trim() !== "" ? Math.round(Number(l.cost) * 100) : 0,
      })),
    };

    const res = isEdit
      ? await updatePurchaseOrderAction({ ...payload, id: existing!.id })
      : await createPurchaseOrderAction(payload);

    setBusy(false);
    if (res.ok && res.order) {
      toast.success(`Order ${res.order.poNo} saved`);
      router.push(`/purchases/${res.order.id}`);
      router.refresh();
    } else {
      const msg = res.error ?? "Could not save. Please try again.";
      setError(msg);
      toast.error(msg);
    }
  }

  if (suppliers.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          <p className="text-sm font-medium">Add a supplier first</p>
          <p className="text-sm text-muted-foreground">
            A purchase order is addressed to someone, so you need at least one supplier.
          </p>
          <Button asChild>
            <Link href="/stock/suppliers">Add a supplier</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}

        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
            <FormField label="Supplier" required>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Order date" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField label="Expected by" hint="Optional — what you were promised.">
              <Input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <FormField label="Add items" hint="Pick an item to add a row.">
              <Select value={pick} onChange={(e) => addProduct(e.target.value)}>
                <option value="">Choose an item…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </Select>
            </FormField>

            {lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No items yet. Choose one above to add the first row.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[38rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Item</TableHead>
                      <TableHead>Order in</TableHead>
                      <TableHead numeric>Qty</TableHead>
                      <TableHead numeric>Rate</TableHead>
                      <TableHead numeric>Amount</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => {
                      const p = byId.get(l.productId);
                      return (
                        <TableRow key={l.key}>
                          <TableCell>
                            <div className="font-medium">{p?.name ?? l.productId.slice(0, 8)}</div>
                            <div className="text-xs text-muted-foreground">{p?.sku}</div>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={l.receiveUnitId}
                              onChange={(e) => updateLine(l.key, { receiveUnitId: e.target.value })}
                              aria-label="Order unit"
                            >
                              {(p?.saleUnits ?? []).map((su) => (
                                <option key={su.id} value={su.id}>
                                  {su.label}
                                </option>
                              ))}
                            </Select>
                          </TableCell>
                          <TableCell numeric>
                            <Input
                              className="w-20 text-right"
                              value={l.quantity}
                              inputMode="decimal"
                              onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                              aria-label="Quantity"
                            />
                          </TableCell>
                          <TableCell numeric>
                            <Input
                              className="w-24 text-right"
                              value={l.cost}
                              inputMode="decimal"
                              placeholder="0.00"
                              onChange={(e) => updateLine(l.key, { cost: e.target.value })}
                              aria-label="Rate"
                            />
                          </TableCell>
                          <TableCell numeric className="tabular-nums">
                            {formatMoney(lineAmount(l))}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeLine(l.key)}
                              aria-label="Remove item"
                            >
                              <XIcon width={16} height={16} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <FormField label="Notes" hint="Printed on the order — delivery instructions, site name.">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </FormField>
          </CardContent>
        </Card>
      </section>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-xs text-muted-foreground">
              An order changes no stock. Stock goes up when the goods arrive and you record the
              receipt.
            </p>
            <div className="flex items-baseline justify-between border-t pt-3 text-base font-semibold">
              <span>Order value</span>
              <span className="tabular-nums">{formatMoney(subtotal)}</span>
            </div>
            <Button className="w-full" onClick={save} disabled={!canSave}>
              {busy ? "Saving…" : isEdit ? "Save changes" : "Save order"}
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href={isEdit ? `/purchases/${existing!.id}` : "/purchases"}>Cancel</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-xs text-muted-foreground">
            <Badge variant="outline">No GST on orders</Badge>
            <p className="mt-2">
              A goods receipt records cost only, so tax typed here would vanish when the goods
              arrive. Enter the landed rate you expect to pay.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
