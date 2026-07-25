import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { getStoreConfig } from "@hardware/core";
import { Toaster } from "@hardware/ui";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

// Tab title tracks the configurable shop name (Settings → Shop name) instead of a
// hardcoded string, so renaming the store updates the browser tab everywhere. Falls
// back when StoreConfig isn't seeded yet.
export async function generateMetadata(): Promise<Metadata> {
  let name = "My Hardware Store";
  try {
    const config = await getStoreConfig();
    if (config?.name) name = config.name;
  } catch {
    // StoreConfig unavailable (e.g. DB not reachable) — keep the fallback.
  }
  return {
    title: { default: `${name} — Admin`, template: `%s · ${name}` },
    description: "Stock, billing and ledger for the shop.",
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Active UI locale (from the NEXT_LOCALE cookie, via the next-intl request config) +
  // the merged messages for it. The provider wraps the root so EVERY admin route —
  // including the (auth)/login group outside the (admin) shell — can translate, and
  // `lang` reflects the active locale.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
