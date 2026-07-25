import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Tabs, TabsList, TabsLink, ForbiddenState } from "@hardware/ui";

// Shared stock-section chrome. Lives outside page.tsx because a Next route file may
// only export `default` + route-config symbols — re-exporting components from a
// page breaks the build's page-type check.
//
// The section nav is rendered through the shared `Tabs` link-mode pattern (§3.1) so
// the active underline + a11y state matches Billing/Ledger/Reports.

const ITEMS: { href: string; key: string }[] = [
  { href: "/stock", key: "list" },
  { href: "/stock/grn", key: "grn" },
  { href: "/stock/adjustments", key: "adjust" },
  { href: "/stock/movements", key: "movements" },
  { href: "/stock/near-expiry", key: "expiry" },
  { href: "/stock/suppliers", key: "suppliers" },
];

export async function StockNav({ active }: { active: string }) {
  const t = await getTranslations("stock");
  return (
    <Tabs>
      <TabsList aria-label={t("nav.sections")}>
        {ITEMS.map((i) => (
          <TabsLink key={i.key} active={i.key === active}>
            <Link href={i.href}>{t(`nav.${i.key}`)}</Link>
          </TabsLink>
        ))}
      </TabsList>
    </Tabs>
  );
}

// Shared 403 preset (replaces the old bespoke `Forbid`). Wording is preserved by
// `ForbiddenState`. Kept as a thin wrapper so existing call sites stay unchanged.
export function Forbid({ perm }: { perm: string }) {
  return (
    <div className="space-y-6">
      <ForbiddenState perm={perm} />
    </div>
  );
}
