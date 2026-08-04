"use client";

import { useActionState, useRef, useState } from "react";
import { Button, Card, CardContent, Input } from "@hardware/ui";
import { pinLoginAction, type PinLoginState } from "./actions";

/**
 * PIN pad shown when this device has been remembered. Falls back to the password form on
 * request, and automatically once the PIN locks — a shopkeeper must never be stranded.
 */
export function PinLoginForm({
  staffName,
  onUsePassword,
}: {
  staffName?: string;
  onUsePassword: () => void;
}) {
  const [pin, setPin] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<PinLoginState, FormData>(pinLoginAction, {});

  // A locked PIN is a dead end — send them straight to the password form.
  if (state.locked) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <p className="text-sm text-destructive">{state.error}</p>
          <Button className="w-full" onClick={onUsePassword}>
            Sign in with password
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="text-center">
            <p className="text-sm font-medium">
              {staffName ? `Welcome back, ${staffName}` : "Welcome back"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Enter your 4-digit PIN</p>
          </div>

          {state.error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {state.error}
              {typeof state.attemptsLeft === "number" && state.attemptsLeft > 0 && (
                <span className="block text-xs text-muted-foreground">
                  {state.attemptsLeft} {state.attemptsLeft === 1 ? "try" : "tries"} left
                </span>
              )}
            </p>
          )}

          <Input
            name="pin"
            value={pin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(v);
              // Submit on the fourth digit — no button press at a busy counter.
              if (v.length === 4) requestAnimationFrame(() => formRef.current?.requestSubmit());
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            type="password"
            autoFocus
            disabled={pending}
            aria-label="PIN"
            className="mx-auto w-40 text-center text-2xl tracking-[0.6em]"
            placeholder="••••"
          />

          <Button type="submit" className="w-full" disabled={pending || pin.length !== 4}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>

          <button
            type="button"
            onClick={onUsePassword}
            className="w-full text-center text-xs text-muted-foreground underline hover:text-foreground"
          >
            Use my password instead
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
