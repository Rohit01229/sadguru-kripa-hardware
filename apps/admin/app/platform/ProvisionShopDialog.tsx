"use client";

import { useActionState, useState } from "react";
import { Button, Card, CardContent, FormField, Input, StateCodePicker } from "@hardware/ui";
import { provisionShopAction, type ProvisionState } from "./actions";

/**
 * Create a shop and its owner in one step (16 §4a).
 *
 * Provisioning is atomic in the core, so this form either produces a working shop —
 * settings, owner, starter units — or nothing. On success it shows the credentials once
 * so the operator can pass them on; we never store or re-display the password.
 */
export function ProvisionShopDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ProvisionState, FormData>(
    provisionShopAction,
    {},
  );

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Create shop</Button>;
  }

  // Success panel — shown until dismissed, because the password is not recoverable.
  if (state.created) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
        <Card className="w-full max-w-lg">
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="text-base font-semibold">Shop created</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Give these details to the shop owner. The password is not shown again.
              </p>
            </div>
            <dl className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Shop</dt>
                <dd className="font-medium">{state.created.shopName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Address</dt>
                <dd className="font-mono text-xs">{state.created.slug}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Owner login</dt>
                <dd className="font-medium">{state.created.ownerEmail}</dd>
              </div>
            </dl>
            <Button
              className="w-full"
              onClick={() => {
                setOpen(false);
                // Reload so the new shop appears in the list.
                window.location.reload();
              }}
            >
              Done
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <Card className="w-full max-w-lg">
        <CardContent className="pt-6">
          <form action={formAction} className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">Create a shop</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This sets up the shop and its owner account together.
              </p>
            </div>

            {state.error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {state.error}
              </p>
            )}

            <FormField label="Shop name" required>
              <Input name="name" placeholder="Sadguru Kripa Hardware" autoFocus />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Short address" required hint="Used in links later.">
                <Input name="slug" placeholder="sadguru-kripa" />
              </FormField>
              <FormField label="State" required hint="Decides CGST/SGST vs IGST.">
                <StateCodePicker name="homeState" defaultValue="19" />
              </FormField>
            </div>
            <FormField label="GSTIN" hint="Optional — the owner can add it later.">
              <Input name="gstin" placeholder="19ABCDE1234F1Z5" />
            </FormField>

            <div className="border-t pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Owner account
              </p>
              <div className="space-y-4">
                <FormField label="Owner name" required>
                  <Input name="ownerName" placeholder="Ramesh Kumar" />
                </FormField>
                <FormField label="Owner email" required hint="They sign in with this.">
                  <Input name="ownerEmail" type="email" placeholder="owner@shop.com" />
                </FormField>
                <FormField label="Temporary password" required hint="At least 8 characters.">
                  <Input name="ownerPassword" type="text" placeholder="Share this with the owner" />
                </FormField>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1" disabled={pending}>
                {pending ? "Creating…" : "Create shop"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
