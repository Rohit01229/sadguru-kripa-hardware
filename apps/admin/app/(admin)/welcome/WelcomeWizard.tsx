"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FullStoreConfigDTO, OnboardingState } from "@hardware/core";
import {
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  StateCodePicker,
  Textarea,
  toast,
} from "@hardware/ui";
import {
  saveShopDetailsAction,
  addFirstItemAction,
  finishOnboardingAction,
  type WizardState,
} from "./actions";

/**
 * Three-step first-run wizard (16 §6): shop details → a few items → first bill.
 *
 * Deliberately skippable at every step. An owner who already knows the app, or who is
 * importing a spreadsheet, should not be trapped behind a tutorial — and a wizard you
 * cannot escape is its own kind of "too hard to use".
 */
export function WelcomeWizard({
  config,
  state,
  shopName,
}: {
  config: FullStoreConfigDTO;
  state: OnboardingState;
  shopName: string;
}) {
  const router = useRouter();
  // Start on the first step that isn't already satisfied, so a returning owner picks up
  // where they left off instead of re-confirming details they already entered.
  const [step, setStep] = useState<1 | 2 | 3>(state.progress.itemCount > 0 ? 3 : 1);
  const [itemsAdded, setItemsAdded] = useState(state.progress.itemCount);
  const [pendingFinish, startFinish] = useTransition();

  function finish(skipped: boolean) {
    startFinish(async () => {
      const res = await finishOnboardingAction(skipped);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      router.push(skipped ? "/dashboard" : "/billing");
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Welcome to {shopName}</h1>
        <p className="text-sm text-muted-foreground">
          Three quick steps and you can make your first bill.
        </p>
      </div>

      <Steps current={step} itemsAdded={itemsAdded} />

      {step === 1 && (
        <DetailsStep config={config} onDone={() => setStep(2)} />
      )}

      {step === 2 && (
        <ItemsStep
          itemsAdded={itemsAdded}
          onAdded={() => setItemsAdded((n) => n + 1)}
          onDone={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <Card>
          <CardContent className="space-y-4 pt-6 text-center">
            <p className="text-base font-medium">You&apos;re set up.</p>
            <p className="text-sm text-muted-foreground">
              {itemsAdded > 0
                ? `${itemsAdded} item${itemsAdded === 1 ? "" : "s"} added. Ring up a sale to see how billing works — tax and the bill number are automatic.`
                : "You can add items any time. Ring up a sale whenever you're ready."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button onClick={() => finish(false)} disabled={pendingFinish}>
                Make my first bill
              </Button>
              <Button variant="outline" onClick={() => finish(true)} disabled={pendingFinish}>
                Go to dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => finish(true)}
          disabled={pendingFinish}
          className="underline hover:text-foreground"
        >
          Skip setup — I&apos;ll do this later
        </button>
      </p>
    </div>
  );
}

function Steps({ current, itemsAdded }: { current: number; itemsAdded: number }) {
  const steps = [
    { n: 1, label: "Your shop" },
    { n: 2, label: itemsAdded > 0 ? `Items (${itemsAdded})` : "Items" },
    { n: 3, label: "First bill" },
  ];
  return (
    <ol className="flex items-center justify-center gap-2 text-xs">
      {steps.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2">
          <span
            className={
              s.n <= current
                ? "flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                : "flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground"
            }
          >
            {s.n}
          </span>
          <span className={s.n === current ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
          {i < steps.length - 1 && <span className="w-6 border-t" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function DetailsStep({ config, onDone }: { config: FullStoreConfigDTO; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<WizardState, FormData>(async (prev, fd) => {
    const res = await saveShopDetailsAction(prev, fd);
    if (res.ok) onDone();
    return res;
  }, {});

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="text-sm font-semibold">Your shop</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This appears on every bill you print. You can change it later in Settings.
          </p>
        </div>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          <FormField label="Shop name" required>
            <Input name="name" defaultValue={config.name} autoFocus />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="State" required hint="Decides CGST/SGST vs IGST on bills.">
              <StateCodePicker name="homeState" defaultValue={config.homeState} />
            </FormField>
            <FormField label="Phone" hint="Printed on bills.">
              <Input name="phone" defaultValue={config.phone ?? ""} inputMode="tel" />
            </FormField>
          </div>
          <FormField label="GSTIN" hint="Leave blank if you're not registered.">
            <Input name="gstin" defaultValue={config.gstin ?? ""} placeholder="19ABCDE1234F1Z5" />
          </FormField>
          <FormField label="Address">
            <Textarea name="address" defaultValue={config.address ?? ""} rows={2} />
          </FormField>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ItemsStep({
  itemsAdded,
  onAdded,
  onDone,
  onBack,
}: {
  itemsAdded: number;
  onAdded: () => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    startTransition(async () => {
      const res = await addFirstItemAction(name, price);
      if (res.ok) {
        setName("");
        setPrice("");
        setError(null);
        onAdded();
        toast.success("Item added.");
      } else {
        setError(res.error ?? "Could not add the item.");
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="text-sm font-semibold">Add a few items</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Just a name and a price — we fill in the item code and unit for you.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            aria-label="Item name"
          />
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Selling price"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            aria-label="Selling price"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button onClick={add} disabled={pending || !name.trim() || price.trim() === ""}>
            Add
          </Button>
        </div>

        {itemsAdded > 0 && (
          <p className="text-sm text-muted-foreground">
            {itemsAdded} item{itemsAdded === 1 ? "" : "s"} added.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Have a list already?{" "}
          <Link href="/catalog/import" className="underline hover:text-foreground">
            Import from Excel or CSV
          </Link>
          .
        </p>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={pending}>
            Back
          </Button>
          <Button onClick={onDone} disabled={pending} className="flex-1">
            {itemsAdded > 0 ? "Continue" : "Skip for now"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
