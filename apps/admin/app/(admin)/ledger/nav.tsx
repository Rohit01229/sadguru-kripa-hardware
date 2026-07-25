import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TabsList, TabsLink, ForbiddenState } from "@hardware/ui";

// Shared ledger-section chrome (mirrors billing/nav.tsx + stock/nav.tsx). A Next
// route file may only export `default` + route-config symbols, so shared components
// live here. Section nav renders through the shared Tabs link-mode pattern so the
// active underline matches the rest of the admin console (§3.1).

export async function LedgerNav({ active }: { active: string }) {
  const t = await getTranslations("ledger");
  const items: { href: string; label: string; key: string }[] = [
    { href: "/ledger", label: t("nav.directory"), key: "directory" },
  ];
  return (
    <TabsList aria-label={t("nav.sections")}>
      {items.map((i) => (
        <TabsLink key={i.key} active={i.key === active}>
          <Link href={i.href}>{i.label}</Link>
        </TabsLink>
      ))}
    </TabsList>
  );
}

/** Shared 403 preset (preserves the existing perm wording). */
export function Forbid({ perm }: { perm: string }) {
  return <ForbiddenState perm={perm} />;
}
