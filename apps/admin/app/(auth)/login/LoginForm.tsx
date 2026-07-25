"use client";

import { useActionState } from "react";
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

// Staff sign-in form. Submits to the loginAction server action which authenticates
// against the staff realm (argon2id), rate-limits, and sets the opaque
// `hw.staff.session` cookie the middleware checks. Presentation only — the action,
// its validation, and the autocomplete attributes are unchanged. `storeName` comes
// from the server page (StoreConfig) so the heading reflects the configured shop.
const initialState: LoginState = {};

export function LoginForm({ storeName }: { storeName: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

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
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  required
                  aria-invalid={state.error ? true : undefined}
                />
              </FormField>

              {state.error ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {state.error}
                </div>
              ) : null}

              <Button type="submit" className="w-full" isLoading={pending}>
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
