import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { getStoreConfig } from "@hardware/core";
import { Toaster } from "@hardware/ui";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { PwaRegister } from "./PwaRegister";

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
    // PWA: makes the admin console installable (manifest + icons + iOS home-screen meta).
    manifest: "/manifest.webmanifest",
    applicationName: "SK Admin",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "SK Admin" },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#2f2018",
};

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
          <PwaRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
