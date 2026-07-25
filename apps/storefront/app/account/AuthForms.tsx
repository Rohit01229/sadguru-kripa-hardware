"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@hardware/ui";

type Mode = "login" | "register" | "reset";

// Login / register / reset forms (reuse the S1 customer auth routes). Register sends
// an email-verification link (enumeration-safe); login mints the customer session;
// reset requests an (enumeration-safe) password-reset link.
export function AuthForms() {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetEmail, setResetEmail] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: string) {
    setMode(next as Mode);
    setError(null);
    setInfo(null);
  }

  async function login() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const res = await fetch("/api/customer/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(t("auth.signedInToast"));
      router.refresh();
    } else {
      setError(t("auth.loginError"));
    }
  }

  async function register() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const res = await fetch("/api/customer/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    setBusy(false);
    if (res.ok) {
      const message = t("auth.registerInfo");
      setInfo(message);
      toast.success(t("auth.registerToast"));
    } else {
      setError(t("auth.registerError"));
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const res = await fetch("/api/customer/password/reset-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resetEmail }),
    });
    setBusy(false);
    if (res.ok) {
      const message = t("auth.resetInfo");
      setInfo(message);
      toast.success(t("auth.resetToast"));
    } else {
      setError(t("auth.resetError"));
    }
  }

  return (
    <Card className="mt-6 max-w-md">
      <CardContent className="pt-6">
        <Tabs value={mode} onValueChange={switchMode}>
          <TabsList>
            <TabsTrigger value="login">{t("auth.tabSignIn")}</TabsTrigger>
            <TabsTrigger value="register">{t("auth.tabCreateAccount")}</TabsTrigger>
            <TabsTrigger value="reset">{t("auth.tabReset")}</TabsTrigger>
          </TabsList>

          {(error || info) && (
            <Alert
              className="mt-4"
              variant={error ? "destructive" : "info"}
              description={error ?? info}
            />
          )}

          <TabsContent value="login" className="mt-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                login();
              }}
            >
              <FormField label={t("auth.emailLabel")}>
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                />
              </FormField>
              <FormField label={t("auth.passwordLabel")}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                />
              </FormField>
              <Button type="submit" className="w-full" isLoading={busy}>
                {t("auth.tabSignIn")}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="register" className="mt-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                register();
              }}
            >
              <FormField label={t("auth.nameLabel")}>
                <Input
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("auth.namePlaceholder")}
                />
              </FormField>
              <FormField label={t("auth.emailLabel")}>
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                />
              </FormField>
              <FormField label={t("auth.passwordLabel")}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.registerPasswordPlaceholder")}
                />
              </FormField>
              <Button type="submit" className="w-full" isLoading={busy}>
                {t("auth.tabCreateAccount")}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="reset" className="mt-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                reset();
              }}
            >
              <FormField label={t("auth.emailLabel")} hint={t("auth.resetEmailHint")}>
                <Input
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                />
              </FormField>
              <Button type="submit" className="w-full" isLoading={busy}>
                {t("auth.sendResetLink")}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
