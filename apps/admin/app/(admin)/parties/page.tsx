import Link from "next/link";
import { redirect } from "next/navigation";
import { listParties, requirePermission, Forbidden, can } from "@hardware/core";
import {
  PageHeader,
  Button,
  Card,
  CardContent,
  Alert,
  EmptyState,
  ForbiddenState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../lib/session";
import { PartiesNav, PartyBalance, PartyKindBadge } from "./nav";
import { PartySearch } from "./PartySearch";
import { normalisePhone } from "../billing/share";

// The unified parties directory (21d) — myBillBook's Parties screen.
//
// Customers and suppliers in ONE list, ordered by how much money is at stake rather
// than alphabetically: this is a call sheet, not a phone book.
export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; hasBalance?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  // Either permission gets you in, and you see only the side you are allowed to see —
  // a counter role with customers.read but not suppliers.read gets a customer list,
  // not a 403.
  const mayCustomers = can(session, "customers.read");
  const maySuppliers = can(session, "suppliers.read");
  if (!mayCustomers && !maySuppliers) {
    try {
      requirePermission(session, "customers.read");
    } catch (e) {
      if (e instanceof Forbidden) return <ForbiddenState perm="customers.read / suppliers.read" />;
      throw e;
    }
  }

  const shopId = await requireShopId();
  const sp = await searchParams;
  const kind = sp.kind === "CUSTOMER" || sp.kind === "SUPPLIER" ? sp.kind : undefined;
  const hasBalance = sp.hasBalance === "1";
  const q = sp.q?.trim() ?? "";

  const result = await listParties(
    shopId,
    { kind, q: q || undefined, hasBalance },
    { customers: mayCustomers, suppliers: maySuppliers },
  );
  const mayAdd = can(session, "customers.write") || can(session, "suppliers.write");

  const base = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/parties?${qs}` : "/parties";
  };

  const tabs = [
    { key: "", label: "All", count: result.counts.all, href: base({ hasBalance: hasBalance ? "1" : "" }) },
    {
      key: "CUSTOMER",
      label: "Customers",
      count: result.counts.customers,
      href: base({ kind: "CUSTOMER", hasBalance: hasBalance ? "1" : "" }),
    },
    {
      key: "SUPPLIER",
      label: "Suppliers",
      count: result.counts.suppliers,
      href: base({ kind: "SUPPLIER", hasBalance: hasBalance ? "1" : "" }),
    },
  ];

  return (
    <div className="space-y-6">
      <PartiesNav active="parties" />
      <PageHeader
        title="Parties"
        description="Everyone you buy from and sell to, with what is owed either way."
        actions={
          mayAdd ? (
            <Button asChild>
              <Link href="/parties/new">Add party</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">To collect</div>
            <div className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatMoney(result.totals.toCollect)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Owed to you by customers.</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">To pay</div>
            <div className="text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {formatMoney(result.totals.toPay)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Goods received from suppliers, not yet paid for.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <Button
            key={t.key || "all"}
            asChild
            size="sm"
            variant={(kind ?? "") === t.key ? "default" : "outline"}
          >
            <Link href={t.href}>
              {t.label} <span className="ml-1.5 tabular-nums opacity-70">{t.count}</span>
            </Link>
          </Button>
        ))}
        <Button asChild size="sm" variant={hasBalance ? "default" : "outline"}>
          <Link href={base({ kind: kind ?? "", hasBalance: hasBalance ? "" : "1" })}>
            Only with balance
          </Link>
        </Button>
      </div>

      <PartySearch q={q} kind={kind ?? ""} hasBalance={hasBalance} />

      {result.truncated && (
        <Alert>
          Showing the first 2,000 of each kind. Use search to narrow it down.
        </Alert>
      )}

      {result.data.length === 0 ? (
        <EmptyState
          title={q ? `Nobody matches “${q}”` : "No parties yet"}
          description={
            q
              ? "Try a different name, phone number or GSTIN."
              : "Add the customers you sell to and the suppliers you buy from."
          }
          action={
            mayAdd && !q ? (
              <Button asChild>
                <Link href="/parties/new">Add party</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[40rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead numeric>Balance</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.map((p) => (
                    <TableRow key={`${p.kind}-${p.id}`}>
                      <TableCell>
                        <Link href={p.href} className="font-medium text-primary hover:underline">
                          {p.name}
                        </Link>
                        {p.gstin && (
                          <div className="font-mono text-xs text-muted-foreground">{p.gstin}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <PartyKindBadge kind={p.kind} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.phone ?? "—"}</TableCell>
                      <TableCell numeric>
                        <PartyBalance balance={p.balance} />
                      </TableCell>
                      <TableCell>
                        {/* One tap to chase a debt is the whole reason a shopkeeper
                            opens this screen. No phone on file → no button, rather
                            than a link that opens an empty chat. */}
                        {p.phone && p.balance > 0 && (
                          <div className="flex justify-end">
                            <Button asChild size="sm" variant="ghost">
                              <a
                                href={reminderUrl(p.name, p.phone, p.balance)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Remind
                              </a>
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * A polite WhatsApp balance reminder.
 *
 * Deliberately NOT buildWhatsAppUrl: that one formats a BILL, and feeding it an empty
 * invoice number and no lines would send "Bill · 11 Aug 2026" with a blank item list.
 * Only `normalisePhone` is worth sharing — the part that knows a bare 10-digit Indian
 * number needs a 91 in front.
 */
function reminderUrl(name: string, phone: string, balancePaise: number): string {
  const amount = `₹${(balancePaise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const text = encodeURIComponent(
    `Namaste ${name},\n\nA balance of *${amount}* is outstanding on your account.\n\nKindly clear it at your convenience. Thank you!`,
  );
  const to = normalisePhone(phone);
  return to ? `https://wa.me/${to}?text=${text}` : `https://wa.me/?text=${text}`;
}
