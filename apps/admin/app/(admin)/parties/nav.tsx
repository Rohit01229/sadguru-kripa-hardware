import Link from "next/link";
import { Badge, Tabs, TabsList, TabsLink, formatMoney } from "@hardware/ui";

// Shared parties chrome. A route file may only export `default` + route config, so
// shared components live here (same pattern as billing/nav and sales/nav).
//
// The section pairs the DIRECTORY (who they are) with the KHATA (what they owe), which
// is how myBillBook splits Parties from the ledger detail — same two ideas, one place.

export function PartiesNav({ active }: { active: string }) {
  // Two tabs, both genuinely in this section. Supplier admin deliberately is NOT a tab
  // here — it lives in the Stock section, and a tab that jumps the user into a
  // different sidebar entry is worse than a row link that clearly goes somewhere else.
  const items = [
    { href: "/parties", label: "All parties", key: "parties" },
    { href: "/ledger", label: "Khata & dues", key: "ledger" },
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

/**
 * A party's balance, in the shop's own words.
 *
 * The sign carries the meaning everywhere in this section: positive means money is
 * coming in, negative means it is going out. Rendering "₹0" as a dash rather than a
 * number keeps the eye on the rows that actually need chasing.
 */
export function PartyBalance({ balance }: { balance: number }) {
  if (balance === 0) return <span className="text-muted-foreground">—</span>;
  if (balance > 0) {
    return (
      <span className="font-medium text-emerald-700 dark:text-emerald-400">
        {formatMoney(balance)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">to collect</span>
      </span>
    );
  }
  return (
    <span className="font-medium text-amber-700 dark:text-amber-400">
      {formatMoney(-balance)}
      <span className="ml-1 text-xs font-normal text-muted-foreground">to pay</span>
    </span>
  );
}

export function PartyKindBadge({ kind }: { kind: string }) {
  return kind === "SUPPLIER" ? (
    <Badge variant="info">Supplier</Badge>
  ) : (
    <Badge variant="outline">Customer</Badge>
  );
}
