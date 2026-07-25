"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from "@hardware/ui";
import { loginAction, type LoginState } from "./actions";

/** Eye / eye-off glyphs for the show-password toggle. */
function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/** mm:ss for the lockout countdown. */
function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Staff sign-in form. Submits to the loginAction server action which authenticates
// against the staff realm (argon2id), rate-limits, and sets the opaque
// `hw.staff.session` cookie the middleware checks. Presentation only — the action,
// its validation, and the autocomplete attributes are unchanged. `storeName` comes
// from the server page (StoreConfig) so the heading reflects the configured shop.
const initialState: LoginState = {};

export function LoginForm({ storeName }: { storeName: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [showPw, setShowPw] = useState(false);

  // Live lockout countdown: seed from the action's retryAfterSec on each response,
  // then tick down to 0 (one setTimeout per second — cleaned up on each change).
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (state.retryAfterSec && state.retryAfterSec > 0) setRemaining(state.retryAfterSec);
  }, [state]);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <svg
              width={22}
              height={22}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </span>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">{storeName}</h1>
            <p className="text-sm text-muted-foreground">Sign in to the operations console.</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Owner sign in</CardTitle>
            <CardDescription>Use your staff email and password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <FormField label="Email" htmlFor="email">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@shop.example"
                  required
                  aria-invalid={state.error ? true : undefined}
                />
              </FormField>
              <FormField label="Password" htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Password"
                    required
                    className="pr-10"
                    aria-invalid={state.error ? true : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    aria-pressed={showPw}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <EyeIcon off={showPw} />
                  </button>
                </div>
              </FormField>

              {state.error ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {state.error}
                  {remaining > 0 && (
                    <span className="mt-1 block font-mono text-xs">
                      You can try again in{" "}
                      <span className="font-semibold tabular-nums">{mmss(remaining)}</span>
                    </span>
                  )}
                </div>
              ) : null}

              <Button type="submit" className="w-full" isLoading={pending} disabled={remaining > 0}>
                {remaining > 0 ? `Locked — retry in ${mmss(remaining)}` : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
