"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  CheckCircleIcon,
  AlertTriangleIcon,
  toast,
} from "@hardware/ui";

// Collects a new password and confirms the reset against the existing
// /api/customer/password/reset route. The server enforces token validity and the
// 8-char minimum; we mirror the minimum client-side for fast feedback only.
export function ResetPasswordClient() {
  const t = useTranslations("account");
  const params = useSearchParams();
  const token = params.get("token");

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  if (!token) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangleIcon width={24} height={24} className="text-destructive" />
          </span>
          <CardTitle>{t("reset.missingTitle")}</CardTitle>
          <CardDescription>{t("reset.missingDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/account">{t("reset.backToAccount")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-success/10">
            <CheckCircleIcon width={24} height={24} className="text-success" />
          </span>
          <CardTitle>{t("reset.doneTitle")}</CardTitle>
          <CardDescription>{t("reset.doneDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/account">{t("reset.goToSignIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("reset.tooShortError"));
      return;
    }
    if (password !== confirm) {
      setError(t("reset.mismatchError"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/customer/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setDone(true);
        toast.success(t("reset.updatedToast"));
      } else {
        setError(t("reset.invalidTokenError"));
      }
    } catch {
      setError(t("reset.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reset.formTitle")}</CardTitle>
        <CardDescription>{t("reset.formDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <FormField label={t("reset.newPasswordLabel")} hint={t("reset.newPasswordHint")}>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <FormField label={t("reset.confirmPasswordLabel")}>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </FormField>

          {error ? <Alert variant="destructive" description={error} /> : null}

          <Button type="submit" className="w-full" isLoading={busy}>
            {t("reset.updatePassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
