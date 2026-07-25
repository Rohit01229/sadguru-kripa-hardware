import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Tabs, TabsList, TabsLink, ForbiddenState } from "@hardware/ui";

// Shared reports-section chrome (mirrors stock/nav.tsx + billing/nav.tsx). A Next route
// file may only export `default` + route-config symbols, so shared components live here.
// The nav renders through the shared Tabs link pattern (§3.1) so the active style + a11y
// match the rest of the admin; Forbid delegates to the shared ForbiddenState (wording
// preserved). Money is formatted via the shared formatMoney helper in each page.

export async function ReportsNav({ active }: { active: string }) {
  const t = await getTranslations("reports");
  const items: { href: string; label: string; key: string }[] = [
    { href: "/reports", label: t("nav.dayEnd"), key: "day-end" },
    { href: "/reports/sales", label: t("nav.sales"), key: "sales" },
    { href: "/reports/gstr1", label: t("nav.gstr1"), key: "gstr1" },
    { href: "/reports/valuation", label: t("nav.valuation"), key: "valuation" },
  ];
  return (
    <Tabs value={active}>
      <TabsList aria-label={t("nav.sections")}>
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
