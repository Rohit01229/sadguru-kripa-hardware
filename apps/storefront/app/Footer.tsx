import Link from "next/link";
import { getTranslations } from "next-intl/server";

// Storefront footer (§3.2, new). Store name + blurb, payment note, GST/HSN note,
// copyright. Muted, centered, stacks on mobile. Server component — chrome strings are
// localized via getTranslations('common'). The shop name is data (StoreConfig, Settings →
// Shop name) and is threaded from the server layout untranslated.
export async function Footer({ storeName }: { storeName: string }) {
  const t = await getTranslations("common");
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t bg-muted/30">
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <p className="text-base font-semibold">{storeName}</p>
          <p className="text-sm text-muted-foreground">{t("footer.blurb")}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">{t("footer.shop")}</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>
              <Link href="/" className="hover:text-foreground hover:underline">
                {t("shell.catalog")}
              </Link>
            </li>
            <li>
              <Link href="/cart" className="hover:text-foreground hover:underline">
                {t("shell.cart")}
              </Link>
            </li>
            <li>
              <Link href="/orders" className="hover:text-foreground hover:underline">
                {t("shell.myOrders")}
              </Link>
            </li>
            <li>
              <Link href="/account" className="hover:text-foreground hover:underline">
                {t("shell.account")}
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">{t("footer.payment")}</p>
          <p className="text-sm text-muted-foreground">{t("footer.paymentNote")}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">{t("footer.billing")}</p>
          <p className="text-sm text-muted-foreground">{t("footer.billingNote")}</p>
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {storeName}. {t("footer.rightsReserved")}</p>
          <p>{t("footer.pricesNote")}</p>
        </div>
      </div>
    </footer>
  );
}
