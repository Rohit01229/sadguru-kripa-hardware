import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Toaster } from "@hardware/ui";
import { cache } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getStoreConfig } from "@hardware/core";
import { CartProvider } from "./cart/CartStore";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { getCustomerSession } from "../lib/session";
import { logoutAction } from "./account/actions";

// Title/brand come from the single StoreConfig row (no permission gate; safe for the
// unauthenticated shell). Falls back to the seeded default if the store is not yet set up.
// cache() dedupes the metadata + layout reads into ONE DB round-trip per request; the
// try/catch degrades a StoreConfig blip to the default instead of throwing out of the
// root layout (which would white-screen the whole app, including the login page).
const resolveStoreName = cache(async (): Promise<string> => {
  try {
    const config = await getStoreConfig();
    return config?.name ?? "My Hardware Store";
  } catch {
    return "My Hardware Store";
  }
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await resolveStoreName(),
    description: "Paint, electrical, plumbing, tools and more.",
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Resolve the customer session here so the Header can show an account menu with
  // Sign out (signed in) or a Sign in link (signed out). The logout server action is
  // passed down and posted from a <form> in the menu (mirrors the admin shell).
  const session = await getCustomerSession();
  const isAuthed = Boolean(session?.customerId);

  // Brand name from StoreConfig (Settings → Shop name), threaded into the header/footer.
  const storeName = await resolveStoreName();

  // Active UI locale (from the NEXT_LOCALE cookie, via the next-intl request config) +
  // the merged messages for it, handed to the client provider so client components
  // (Header, LanguageSwitcher, …) can translate. `lang` reflects the active locale.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CartProvider>
            <div className="flex min-h-screen flex-col">
              <Header isAuthed={isAuthed} logoutAction={logoutAction} storeName={storeName} />
              <main className="flex-1">{children}</main>
              <Footer storeName={storeName} />
            </div>
            <Toaster />
          </CartProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
