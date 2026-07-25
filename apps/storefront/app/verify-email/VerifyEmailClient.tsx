"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  AlertTriangleIcon,
  CheckCircleIcon,
} from "@hardware/ui";

// Consumes the emailed verification token. Posts once to the existing
// /api/customer/verify-email route (no behavior change) and presents the result.
type Status = "verifying" | "success" | "error" | "missing";

export function VerifyEmailClient() {
  const t = useTranslations("account");
  const params = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = React.useState<Status>(token ? "verifying" : "missing");

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/customer/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!cancelled) setStatus(res.ok ? "success" : "error");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "verifying") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Spinner />
          <p className="text-sm text-muted-foreground">{t("verify.verifying")}</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-success/10">
            <CheckCircleIcon width={24} height={24} className="text-success" />
          </span>
          <CardTitle>{t("verify.successTitle")}</CardTitle>
          <CardDescription>{t("verify.successDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/account">{t("verify.goToSignIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // error | missing
  const isMissing = status === "missing";
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangleIcon width={24} height={24} className="text-destructive" />
        </span>
        <CardTitle>{isMissing ? t("verify.missingTitle") : t("verify.errorTitle")}</CardTitle>
        <CardDescription>
          {isMissing ? t("verify.missingDescription") : t("verify.errorDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <Link href="/account">{t("verify.backToAccount")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
