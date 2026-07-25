import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Tabs, TabsList, TabsLink, ForbiddenState } from "@hardware/ui";

// Shared billing-section chrome (mirrors stock/nav.tsx). A Next route file may only
// export `default` + route-config symbols, so shared components live here. The nav
// renders through the shared Tabs link pattern (§3.1) so the active style matches the
// rest of the admin; Forbid delegates to the shared ForbiddenState (wording preserved).

export async function BillingNav({ active }: { active: string }) {
  const t = await getTranslations("billing");
  const items: { href: string; label: string; key: string }[] = [
    { href: "/billing", label: t("nav.pos"), key: "pos" },
    { href: "/billing/invoices", label: t("nav.invoices"), key: "invoices" },
  ];
  return (
    <Tabs value={active}>
      <TabsList>
        {items.map((i) => (
          <TabsLink key={i.key} active={i.key === active}>
            <Link href={i.href}>{i.label}</Link>
          </TabsLink>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function Forbid({ perm }: { perm: string }) {
  return (
    <div className="space-y-6">
      <ForbiddenState perm={perm} />
    </div>
  );
}
