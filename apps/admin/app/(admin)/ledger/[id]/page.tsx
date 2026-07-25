import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getStatement, aging, getCustomer, requirePermission, can, Forbidden } from "@hardware/core";
import {
  PageHeader,
  StatCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Badge,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { LedgerNav, Forbid } from "../nav";
import { RecordPaymentForm, ReminderButton } from "./LedgerActions";

// Customer khata statement (S5): full ledger with running balance, aging buckets,
// record-payment + dues-reminder. ledger.read guarded; record-payment/reminder need
// ledger.write (the controls are hidden without it — cosmetic; the action re-checks).

export default async function CustomerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "ledger.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="ledger.read" />;
    throw e;
  }

  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();

  const t = await getTranslations("ledger");
  const TYPE_LABEL: Record<string, string> = {
    INVOICE_DEBIT: t("statement.typeInvoice"),
    PAYMENT_CREDIT: t("statement.typePayment"),
    CREDIT_NOTE_CREDIT: t("statement.typeCreditNote"),
    OPENING: t("statement.typeOpening"),
    ADJUSTMENT: t("statement.typeAdjustment"),
  };

  const [statement, age] = await Promise.all([getStatement(id), aging(id)]);
  const canPay = can(session, "ledger.write");

  return (
    <div className="space-y-6">
      <LedgerNav active="directory" />

      <PageHeader
        breadcrumbs={[
          { label: t("statement.breadcrumb"), href: "/ledger" },
          { label: customer.name },
        ]}
        linkComponent={Link}
        title={customer.name}
        description={`${customer.phone ?? t("statement.noPhone")} · ${customer.gstin ?? t("statement.noGstin")} · ${customer.type}`}
      />

      {/* Aging summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("statement.card0to30")} value={formatMoney(age.bucket0to30)} />
        <StatCard label={t("statement.card31to60")} value={formatMoney(age.bucket31to60)} />
        <StatCard
          label={t("statement.card60plus")}
          value={formatMoney(age.bucket60plus)}
          tone={age.bucket60plus > 0 ? "destructive" : "default"}
        />
        <StatCard
          label={t("statement.cardOutstanding")}
          value={formatMoney(age.outstanding)}
          tone={age.outstanding > 0 ? "warning" : "default"}
        />
      </div>

      {canPay && (
        <div className="space-y-3">
          <RecordPaymentForm customerId={id} />
          <ReminderButton customerId={id} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("statement.heading")}</h2>
        {statement.entries.length === 0 ? (
          <EmptyState
            title={t("statement.emptyTitle")}
            description={t("statement.emptyDescription")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("statement.colDate")}</TableHead>
                  <TableHead>{t("statement.colType")}</TableHead>
                  <TableHead>{t("statement.colReference")}</TableHead>
                  <TableHead numeric>{t("statement.colAmount")}</TableHead>
                  <TableHead numeric>{t("statement.colBalance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.createdAt)}</TableCell>
                    <TableCell>{TYPE_LABEL[e.type] ?? e.type}</TableCell>
                    <TableCell className="text-muted-foreground">{e.note ?? e.refId ?? "—"}</TableCell>
                    <TableCell numeric>
                      {e.amount < 0 ? (
                        <Badge variant="success" className="tabular-nums">
                          {formatMoney(e.amount)}
                        </Badge>
                      ) : (
                        formatMoney(e.amount)
                      )}
                    </TableCell>
                    <TableCell numeric>{formatMoney(e.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
