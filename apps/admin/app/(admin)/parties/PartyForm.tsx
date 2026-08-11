"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Select,
  Textarea,
  toast,
} from "@hardware/ui";
import { createPartyAction } from "./actions";

/**
 * Add a party — one form over two tables, exactly as myBillBook does it.
 *
 * The kind toggle is first because it changes what the rest of the form means: a
 * customer has a khata and a price type, a supplier has neither. Fields that apply to
 * only one side appear only for that side, rather than sitting greyed out.
 */
export function PartyForm({
  mayCustomers,
  maySuppliers,
}: {
  mayCustomers: boolean;
  maySuppliers: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"CUSTOMER" | "SUPPLIER">(
    mayCustomers ? "CUSTOMER" : "SUPPLIER",
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"RETAIL" | "WHOLESALE">("RETAIL");
  const [opening, setOpening] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustomer = kind === "CUSTOMER";

  async function save() {
    if (name.trim().length < 2) {
      setError("Enter the party's name.");
      return;
    }
    setBusy(true);
    setError(null);

    const res = await createPartyAction({
      kind,
      name: name.trim(),
      phone: phone.trim() || null,
      gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
      address: address.trim() || null,
      type: isCustomer ? type : "RETAIL",
      openingBalance:
        isCustomer && opening.trim() !== "" ? Math.round(Number(opening) * 100) : 0,
    });

    setBusy(false);
    if (res.ok && res.party) {
      toast.success(`${res.party.name} added`);
      router.push("/parties");
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

        {mayCustomers && maySuppliers && (
          <div
            role="group"
            aria-label="Party type"
            className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm"
          >
            {(["CUSTOMER", "SUPPLIER"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-md px-4 py-1.5 font-medium transition-colors ${
                  kind === k
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "CUSTOMER" ? "Customer" : "Supplier"}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isCustomer ? "Ramesh Kumar" : "Sharma Traders"}
              autoFocus
            />
          </FormField>

          <FormField label="Phone" hint="Needed to send reminders on WhatsApp.">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="98765 43210"
            />
          </FormField>

          <FormField label="GSTIN" hint="Optional.">
            <Input
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="19ABCDE1234F1Z5"
            />
          </FormField>

          {isCustomer ? (
            <FormField label="Price type" hint="Wholesale customers get bulk rates.">
              <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="RETAIL">Retail</option>
                <option value="WHOLESALE">Wholesale</option>
              </Select>
            </FormField>
          ) : (
            <FormField label="Address" hint="Optional." className="sm:col-span-2">
              <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
            </FormField>
          )}

          {isCustomer && (
            <FormField
              label="Opening balance (₹)"
              hint="What they already owe you from before. Leave blank if nothing."
            >
              <Input
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </FormField>
          )}
        </div>

        {!isCustomer && (
          <p className="text-xs text-muted-foreground">
            A supplier&rsquo;s balance is worked out from the goods you receive and the payments
            you record, so there is no opening balance to enter here.
          </p>
        )}

        <div className="flex gap-2 border-t pt-4">
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save party"}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/parties">Cancel</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
