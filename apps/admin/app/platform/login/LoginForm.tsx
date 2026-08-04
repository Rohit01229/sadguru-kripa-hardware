"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, FormField, Input } from "@hardware/ui";
import { platformLoginAction, type PlatformState } from "../actions";

export function PlatformLoginForm() {
  const [state, formAction, pending] = useActionState<PlatformState, FormData>(
    platformLoginAction,
    {},
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          {state.error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          )}
          <FormField label="Email" required>
            <Input name="email" type="email" autoComplete="username" autoFocus />
          </FormField>
          <FormField label="Password" required>
            <Input name="password" type="password" autoComplete="current-password" />
          </FormField>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
