import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can, getStoreConfig, type Session } from "@hardware/core";
import { getStaffSession } from "../../lib/session";
import { logoutAction } from "./logout/actions";
import { AdminShell, type NavItem } from "./AdminShell";

// Admin app shell (§3.1). Wraps every (admin) route with the sidebar + topbar.
// The nav list is RBAC-gated here using the SAME permission each destination
// already enforces server-side — hiding an item is purely cosmetic; the target
// page still re-checks its own permission. The shell does not change any data flow.

interface NavDef extends NavItem {
  /** True when the session may see this item (cosmetic gate). */
  visible: (s: Session) => boolean;
}

const NAV: NavDef[] = [
  { href: "/dashboard", label: "Dashboard", iconKey: "dashboard", visible: (s) => can(s, "products.read") },
  { href: "/catalog", label: "Catalog", iconKey: "catalog", visible: (s) => can(s, "products.read") },
  { href: "/stock", label: "Stock", iconKey: "stock", visible: (s) => can(s, "stock.read") },
  {
    href: "/billing",
    label: "Billing",
    iconKey: "billing",
    visible: (s) => can(s, "bill.kacha.create") || can(s, "bill.pakka.create"),
  },
  { href: "/ledger", label: "Ledger", iconKey: "ledger", visible: (s) => can(s, "ledger.read") },
  { href: "/orders", label: "Orders", iconKey: "orders", visible: (s) => can(s, "orders.read") },
  { href: "/reports", label: "Reports", iconKey: "reports", visible: (s) => can(s, "reports.read") },
  { href: "/settings", label: "Settings", iconKey: "settings", visible: (s) => can(s, "settings.read") },
  { href: "/audit", label: "Audit", iconKey: "audit", visible: (s) => can(s, "audit.read") },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  // Nav labels are translated server-side here (iconKey === the `common.nav.*` key) and
  // handed to the client shell already localized. The static English `label` in NAV is a
  // source-level fallback only. Permission gating is unchanged.
  const t = await getTranslations("common");
  const items: NavItem[] = NAV.filter((item) => item.visible(session)).map(
    ({ href, iconKey }) => ({ href, iconKey, label: t(`nav.${iconKey}`) }),
  );

  const role = session.roles?.[0] ?? "Staff";
  const user = { name: role, role: `User ${session.userId.slice(0, 8)}` };

  // Brand name from StoreConfig (Settings → Shop name); falls back to the seeded default.
  // Guarded: a StoreConfig read blip must degrade to the default, not throw out of the
  // shell layout and white-screen every admin page.
  let storeName = "My Hardware Store";
  try {
    const config = await getStoreConfig();
    storeName = config?.name ?? "My Hardware Store";
  } catch {
    /* keep default */
  }

  return (
    <AdminShell items={items} user={user} logoutAction={logoutAction} storeName={storeName}>
      {children}
    </AdminShell>
  );
}
