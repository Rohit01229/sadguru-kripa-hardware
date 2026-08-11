"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormField,
  Input,
  Select,
  Textarea,
  formatMoney,
  toast,
} from "@hardware/ui";
import type { ExpenseCategoryDTO, ExpenseDTO, ExpensePaymentMode } from "@hardware/core";
import { createExpenseAction, updateExpenseAction, createExpenseCategoryAction } from "./actions";

/**
 * Record one expense.
 *
 * The shape follows myBillBook: date, category, amount, how it was paid — and nothing
 * else required. GST is behind a toggle because most of what a hardware shop pays for
 * (rent, wages, tea) carries none, and asking about it every time is friction for the
 * common case.
 *
 * The amount asked for is the GROSS — what left the till. That is the number on the
 * bill and in the bank statement; the taxable split is derived from it server-side.
 */

const MODES: { value: ExpensePaymentMode; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CHEQUE", label: "Cheque" },
];

const GST_RATES = ["0", "5", "12", "18", "28"];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ExpenseForm({
  categories: initialCategories,
  existing,
}: {
  categories: ExpenseCategoryDTO[];
  existing?: ExpenseDTO;
}) {
  const router = useRouter();
  const isEdit = existing != null;

  const [categories, setCategories] = useState(initialCategories);
  // Deliberately NOT defaulting to categories[0]: that is whichever name sorts first
  // ("Bank Charges"), and a pre-selected wrong answer gets saved. An empty prompt makes
  // the choice explicit — the same bug the catalog hit with its default category (19 §9).
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [date, setDate] = useState(existing?.date.slice(0, 10) ?? todayIso());
  const [amount, setAmount] = useState(
    existing ? (existing.totalAmount / 100).toFixed(2) : "",
  );
  const [paymentMode, setPaymentMode] = useState<ExpensePaymentMode>(
    existing?.paymentMode ?? "CASH",
  );
  const [paidTo, setPaidTo] = useState(existing?.paidTo ?? "");
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const [withGst, setWithGst] = useState(Boolean(existing && Number(existing.gstRatePct) > 0));
  const [gstRate, setGstRate] = useState(
    existing && Number(existing.gstRatePct) > 0 ? String(Number(existing.gstRatePct)) : "18",
  );
  const [interState, setInterState] = useState(Boolean(existing && existing.igst > 0));
  const [supplierGstin, setSupplierGstin] = useState(existing?.supplierGstin ?? "");

  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPaise = amount.trim() !== "" ? Math.round(Number(amount) * 100) : 0;

  // Mirrors the server's split so the shopkeeper sees the tax portion before saving.
  const split = useMemo(() => {
    const rate = withGst ? Number(gstRate) : 0;
    if (!totalPaise || rate <= 0) return { taxable: totalPaise, tax: 0 };
    const taxable = Math.round((totalPaise * 100) / (100 + rate));
    return { taxable, tax: totalPaise - taxable };
  }, [totalPaise, withGst, gstRate]);

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setAddingCategory(true);
    const res = await createExpenseCategoryAction(name);
    setAddingCategory(false);
    if (res.category) {
      setCategories((cur) =>
        cur.some((c) => c.id === res.category!.id)
          ? cur
          : [...cur, res.category!].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setCategoryId(res.category.id);
      setNewCategory("");
      toast.success(`"${res.category.name}" added`);
    } else {
      toast.error(res.error ?? "Could not add that category.");
    }
  }

  async function save() {
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    if (totalPaise <= 0) {
      setError("Enter an amount.");
      return;
    }
    setBusy(true);
    setError(null);

    const payload = {
      date: new Date(date).toISOString(),
      categoryId,
      paidTo: paidTo.trim() || null,
      paymentMode,
      reference: reference.trim() || null,
      totalAmount: totalPaise,
      gstRatePct: withGst ? Number(gstRate) : 0,
      interState: withGst && interState,
      supplierGstin: withGst && supplierGstin.trim() ? supplierGstin.trim() : null,
      notes: notes.trim() || null,
    };

    const res = isEdit
      ? await updateExpenseAction({ ...payload, id: existing!.id })
      : await createExpenseAction(payload);

    setBusy(false);
    if (res.ok) {
      toast.success(isEdit ? "Expense updated" : `Expense saved — ${formatMoney(totalPaise)}`);
      router.push("/expenses");
      router.refresh();
    } else {
      const msg = res.error ?? "Could not save. Please try again.";
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 pt-6">
        {error && <Alert variant="destructive">{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>

          <FormField label="Amount paid (₹)" required hint="What actually left the till.">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              autoFocus={!isEdit}
            />
          </FormField>

          <FormField label="Category" required>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Paid by" required>
            <Select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as ExpensePaymentMode)}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {/* Add a category without leaving the form — same rule as items and parties. */}
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
          <div className="min-w-[12rem] flex-1">
            <FormField label="New category" hint="Add one if none of the above fits.">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. Shop insurance"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCategory();
                  }
                }}
              />
            </FormField>
          </div>
          <Button
            variant="outline"
            onClick={addCategory}
            disabled={addingCategory || !newCategory.trim()}
          >
            Add
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Paid to" hint="Optional — landlord, transporter, electrician.">
            <Input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
          </FormField>
          <FormField label="Reference" hint="Optional — UTR, cheque or bill number.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </FormField>
        </div>

        {/* GST is opt-in: rent, wages and tea carry none, and that is most expenses. */}
        <div className="space-y-3 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={withGst} onChange={(e) => setWithGst(e.target.checked)} />
            This bill has GST on it
          </label>

          {withGst && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="GST rate">
                  <Select value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
                    {GST_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Supplier GSTIN" hint="Optional.">
                  <Input
                    value={supplierGstin}
                    onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
                    placeholder="19ABCDE1234F1Z5"
                  />
                </FormField>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={interState} onChange={(e) => setInterState(e.target.checked)} />
                Supplier is in another state (IGST)
              </label>
              <dl className="space-y-1 border-t pt-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Value before tax</dt>
                  <dd className="tabular-nums">{formatMoney(split.taxable)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    {interState ? "IGST" : "CGST + SGST"}
                  </dt>
                  <dd className="tabular-nums">{formatMoney(split.tax)}</dd>
                </div>
              </dl>
            </>
          )}
        </div>

        <FormField label="Notes" hint="Optional.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </FormField>

        <div className="flex gap-2 border-t pt-4">
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Save expense"}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/expenses">Cancel</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
