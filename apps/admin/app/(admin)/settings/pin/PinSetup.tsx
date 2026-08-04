"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardContent, FormField, Input, toast } from "@hardware/ui";
import { setPinAction, removePinAction } from "./actions";

/**
 * Set or remove this device's PIN. Scoped to the device you are using — setting one on
 * the counter tablet does not put a PIN on the owner's phone, which is the point.
 */
export function PinSetup({ hasPin }: { hasPin: boolean }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    if (pin !== confirm) {
      setError("The two PINs do not match.");
      return;
    }
    start(async () => {
      const res = await setPinAction(pin, label);
      if (res.ok) {
        setPin("");
        setConfirm("");
        setError(null);
        toast.success("PIN set for this device.");
      } else {
        setError(res.error ?? "Could not set the PIN.");
      }
    });
  }

  function remove() {
    start(async () => {
      const res = await removePinAction();
      if (res.ok) toast.success("PIN removed from this device.");
      else toast.error(res.error ?? "Could not remove the PIN.");
    });
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="text-sm font-semibold">Quick sign-in on this device</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set a 4-digit PIN so you don&apos;t have to type your password every time.
            It only works on this device, and five wrong tries switches back to the password.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {hasPin && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            This device already has a PIN. Setting a new one replaces it.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="New PIN" required>
            <Input
              value={pin}
              onChange={(e) => setPin(digits(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              type="password"
              placeholder="4 digits"
            />
          </FormField>
          <FormField label="Confirm PIN" required>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(digits(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              type="password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && pin.length === 4 && confirm.length === 4) save();
              }}
            />
          </FormField>
        </div>
        <FormField label="Device name" hint="Helps you recognise it later, e.g. Counter tablet.">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Counter tablet" />
        </FormField>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending || pin.length !== 4 || confirm.length !== 4}>
            {hasPin ? "Replace PIN" : "Set PIN"}
          </Button>
          {hasPin && (
            <Button variant="outline" onClick={remove} disabled={pending}>
              Remove PIN from this device
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
