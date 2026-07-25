"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "./LanguageSwitcher";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  ChevronDownIcon,
  MenuIcon,
  SearchIcon,
  cn,
} from "@hardware/ui";
import { useCart } from "./cart/CartStore";

// Storefront header (§3.2): logo / primary nav / search / cart-count badge + an account
// menu, with a mobile Sheet drawer under md. Client component so the cart badge reflects
// the localStorage cart in real time (useCart preserved). The signed-in account menu and
// the logout server action are passed from the server layout, so the header knows whether
// to show Sign out (authed) or Sign in (guest).

// labelKey resolves against the `common.shell.*` namespace at render time.
const NAV = [
  { href: "/", labelKey: "shell.catalog" },
  { href: "/orders", labelKey: "shell.myOrders" },
  { href: "/account", labelKey: "shell.account" },
] as const;

export interface HeaderProps {
  isAuthed: boolean;
  /** Storefront logout server action (clears the session + cookie, redirects to /account). */
  logoutAction: () => void | Promise<void>;
  /** Shop name from StoreConfig (Settings → Shop name). */
  storeName: string;
}

function CartButton({
  count,
  label,
  ariaLabel,
  className,
}: {
  count: number;
  label: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Button variant="outline" size="sm" className={cn("relative gap-2", className)} asChild>
      <Link href="/cart" aria-label={ariaLabel}>
        <CartIcon />
        <span className="hidden sm:inline">{label}</span>
        {count > 0 ? (
          <Badge
            variant="primary"
            className="ml-0.5 h-5 min-w-[1.25rem] justify-center px-1 tabular-nums"
          >
            {count}
          </Badge>
        ) : null}
      </Link>
    </Button>
  );
}

function CartIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function Header({ isAuthed, logoutAction, storeName }: HeaderProps) {
  const t = useTranslations("common");
  const { lineCount } = useCart();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  // Cart aria-label: a short, localized description (item count stays numeric).
  const cartLabel = t("shell.cart");
  const cartAriaLabel = lineCount > 0 ? `${cartLabel} (${lineCount})` : cartLabel;

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t("shell.openMenu")}
          onClick={() => setMobileOpen(true)}
        >
          <MenuIcon width={20} height={20} />
        </Button>

        <Link href="/" className="text-base font-semibold">
          {storeName}
        </Link>

        <nav className="ml-4 hidden items-center gap-5 text-sm md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "transition-colors hover:text-foreground",
                isActive(item.href) ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher className="hidden md:inline-flex" />
          <Button asChild variant="ghost" size="icon" aria-label={t("shell.searchCatalog")}>
            <Link href="/">
              <SearchIcon width={18} height={18} />
            </Link>
          </Button>
          <CartButton count={lineCount} label={cartLabel} ariaLabel={cartAriaLabel} />

          {/* Account menu (desktop). On mobile the same actions live in the nav drawer. */}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="hidden gap-2 md:inline-flex"
                aria-label={t("shell.accountMenu")}
              >
                <UserIcon />
                <ChevronDownIcon width={14} height={14} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>
                {isAuthed ? t("shell.myAccount") : t("shell.welcome")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/account")}>
                {t("shell.account")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/orders")}>
                {t("shell.myOrders")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isAuthed ? (
                <form action={logoutAction}>
                  <DropdownMenuItem type="submit" variant="destructive">
                    {t("shell.signOut")}
                  </DropdownMenuItem>
                </form>
              ) : (
                <DropdownMenuItem onClick={() => router.push("/account")}>
                  {t("shell.signInRegister")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle>{storeName}</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-md px-3 transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive(item.href) ? "bg-accent font-medium text-accent-foreground" : "text-foreground",
                )}
              >
                {t(item.labelKey)}
              </Link>
            ))}
            <Link
              href="/cart"
              className="mt-1 flex min-h-11 items-center rounded-md px-3 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t("shell.cart")}{lineCount > 0 ? ` (${lineCount})` : ""}
            </Link>

            <div className="my-2 h-px bg-muted" />

            {isAuthed ? (
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-destructive transition-colors hover:bg-destructive/10"
                >
                  {t("shell.signOut")}
                </button>
              </form>
            ) : (
              <Link
                href="/account"
                className="flex min-h-11 items-center rounded-md px-3 font-medium text-primary transition-colors hover:bg-accent"
              >
                {t("shell.signInRegister")}
              </Link>
            )}

            <div className="my-2 h-px bg-muted" />
            <div className="px-3 py-1">
              <LanguageSwitcher />
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
