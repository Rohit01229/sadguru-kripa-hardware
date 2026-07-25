"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "./LanguageSwitcher";
import {
  AppShell,
  Sidebar,
  SidebarNav,
  SidebarNavItem,
  Topbar,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Button,
  MenuIcon,
  ChevronDownIcon,
  type IconProps,
} from "@hardware/ui";

// App-specific composition of the shared AppShell. The server layout passes the
// RBAC-filtered nav items + signed-in staff info; this client component owns the
// active-route highlight (usePathname), the mobile sidebar Sheet, and the user menu.
// The logout server action is passed in and posted from a <form> in the menu.

export interface NavItem {
  href: string;
  label: string;
  iconKey: IconKey;
}

export type IconKey =
  | "dashboard"
  | "catalog"
  | "stock"
  | "billing"
  | "ledger"
  | "orders"
  | "reports"
  | "settings"
  | "audit";

// Inline nav icons (kept here so the shell needs no icon dependency).
const navIcons: Record<IconKey, (props: IconProps) => React.ReactElement> = {
  dashboard: (p) => (
    <Icon {...p}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </Icon>
  ),
  catalog: (p) => (
    <Icon {...p}>
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </Icon>
  ),
  stock: (p) => (
    <Icon {...p}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </Icon>
  ),
  billing: (p) => (
    <Icon {...p}>
      <path d="M16 2v5h5" />
      <path d="M21 6v6.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5H17Z" />
      <path d="M7 8v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H15" />
      <path d="M3 12v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H11" />
    </Icon>
  ),
  ledger: (p) => (
    <Icon {...p}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Icon>
  ),
  orders: (p) => (
    <Icon {...p}>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </Icon>
  ),
  reports: (p) => (
    <Icon {...p}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </Icon>
  ),
  settings: (p) => (
    <Icon {...p}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
  audit: (p) => (
    <Icon {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </Icon>
  ),
};

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ storeName }: { storeName: string }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Icon width={16} height={16}>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        </Icon>
      </span>
      <span>{storeName}</span>
    </Link>
  );
}

function NavList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <SidebarNav>
      {items.map((item) => {
        const ItemIcon = navIcons[item.iconKey];
        return (
          <SidebarNavItem
            key={item.href}
            active={isActive(pathname, item.href)}
            icon={<ItemIcon />}
          >
            <Link href={item.href}>{item.label}</Link>
          </SidebarNavItem>
        );
      })}
    </SidebarNav>
  );
}

export interface AdminShellProps {
  items: NavItem[];
  user: { name: string; role: string };
  logoutAction: () => void | Promise<void>;
  /** Shop name from StoreConfig (Settings → Shop name). */
  storeName: string;
  children: React.ReactNode;
}

export function AdminShell({ items, user, logoutAction, storeName, children }: AdminShellProps) {
  const t = useTranslations("common");
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Close the mobile drawer on navigation.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const current = items.find((i) => isActive(pathname, i.href));

  const sidebar = (
    <Sidebar brand={<Brand storeName={storeName} />}>
      <NavList items={items} pathname={pathname} />
    </Sidebar>
  );

  const topbar = (
    <Topbar>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t("shell.openNavigation")}
        onClick={() => setMobileOpen(true)}
      >
        <MenuIcon width={20} height={20} />
      </Button>
      <div className="flex-1 truncate text-sm font-semibold">
        {current?.label ?? t("shell.admin")}
      </div>
      <LanguageSwitcher className="mr-1" />
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button variant="ghost" size="sm" className="gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span className="hidden max-w-[12rem] truncate sm:inline">{user.name}</span>
            <ChevronDownIcon width={14} height={14} className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <div className="truncate font-medium">{user.name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{user.role}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Call the server action directly (not via a submit button): the dropdown
              unmounts its content on select, which would abort a form submission
              mid-flight. An imperative action call isn't tied to the form's lifecycle. */}
          <DropdownMenuItem variant="destructive" onClick={() => logoutAction()}>
            {t("shell.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Topbar>
  );

  return (
    <>
      <AppShell sidebar={sidebar} topbar={topbar}>
        {children}
      </AppShell>

      {/* Mobile sidebar drawer (below lg). */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="flex h-14 items-center border-b px-4">
            <SheetTitle>
              <Brand storeName={storeName} />
            </SheetTitle>
          </SheetHeader>
          <div className="py-4">
            <NavList items={items} pathname={pathname} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
