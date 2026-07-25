import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listCustomers,
  aging,
  requirePermission,
  can,
  Forbidden,
  type AgingBucket,
} from "@hardware/core";
import {
  PageHeader,
  DataTable,
  Badge,
  Button,
  formatMoney,
  type DataTableColumn,
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { LedgerNav, Forbid } from "./nav";
import { CustomerForm } from "./CustomerForm";
import { LedgerFilterBar } from "./LedgerFilterBar";

// Khata directory (S5): counter customers with their current outstanding + aging
// buckets. ledger.read guarded; creating a customer needs customers.write (the form
// is hidden without it — cosmetic; the action re-checks server-side).
//
// Filtering is SERVER-SIDE (URL search params → listCustomers → SQL/derived):
//  - q             — name / phone / GSTIN substring (SQL WHERE).
//  - hasOutstanding — only customers who currently owe (derived Σ; first page only).
//  - agingBucket    — only customers with unpaid debt in current | b31to60 | b60plus
//                     (derived FIFO aging; first page only). hasOutstanding/agingBucket
//                     disable cursor pagination by design (see listCustomers).

type Row = {
  customer: Awaited<ReturnType<typeof listCustomers>>["data"][number];
  age: Awaited<ReturnType<typeof aging>>;
};

const AGING_BUCKET_VALUES: AgingBucket[] = ["current", "b31to60", "b60plus"];

function parseAgingBucket(v: string | undefined): AgingBucket | undefined {
  return AGING_BUCKET_VALUES.some((b) => b === v) ? (v as AgingBucket) : undefined;
}

export default async function LedgerDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; outstanding?: string; aging?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "ledger.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="ledger.read" />;
    throw e;
  }

  const t = await getTranslations("ledger");
  const agingBucketOptions: { value: AgingBucket; label: string }[] = [
    { value: "current", label: t("agingBuckets.current") },
    { value: "b31to60", label: t("agingBuckets.b31to60") },
    { value: "b60plus", label: t("agingBuckets.b60plus") },
  ];

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const hasOutstanding = sp.outstanding === "true";
  const agingBucket = parseAgingBucket(sp.aging);
  const isFiltered = Boolean(q) || hasOutstanding || agingBucket !== undefined;

  const page = await listCustomers({
    q,
    ...(hasOutstanding ? { hasOutstanding: true } : {}),
    ...(agingBucket ? { agingBucket } : {}),
    limit: 50,
  });
  // Per-customer aging (the directory shows the outstanding + 60+ flag at a glance).
  const withAging: Row[] = await Promise.all(
    page.data.map(async (c) => ({ customer: c, age: await aging(c.id) })),
  );
  const canCreate = can(session, "customers.write");

  const columns: DataTableColumn<Row>[] = [
    {
      key: "name",
      header: t("directory.colCustomer"),
      cell: ({ customer: c }) => (
        <Link href={`/ledger/${c.id}`} className="font-medium hover:underline">
          {c.name}
        </Link>
      ),
    },
    {
      key: "phone",
      header: t("directory.colPhone"),
      cell: ({ customer: c }) => <span className="text-muted-foreground">{c.phone ?? "—"}</span>,
    },
    {
      key: "gstin",
      header: t("directory.colGstin"),
      cell: ({ customer: c }) => (
        <span className="text-muted-foreground">{c.gstin ?? "—"}</span>
      ),
    },
    { key: "b0", header: t("directory.col0to30"), numeric: true, cell: ({ age }) => formatMoney(age.bucket0to30) },
    { key: "b30", header: t("directory.col31to60"), numeric: true, cell: ({ age }) => formatMoney(age.bucket31to60) },
    {
      key: "b60",
      header: t("directory.col60plus"),
      numeric: true,
      cell: ({ age }) =>
        age.bucket60plus > 0 ? (
          <Badge variant="destructive" className="tabular-nums">
            {formatMoney(age.bucket60plus)}
          </Badge>
        ) : (
          formatMoney(age.bucket60plus)
        ),
    },
    {
      key: "outstanding",
      header: t("directory.colOutstanding"),
      numeric: true,
      className: "font-semibold",
      cell: ({ age }) => formatMoney(age.outstanding),
    },
    {
      key: "actions",
      header: "",
      cell: ({ customer: c }) => (
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <Link href={`/ledger/${c.id}`}>{t("directory.statement")}</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <LedgerNav active="directory" />

      <PageHeader
        title={t("directory.title")}
        description={t("directory.description")}
      />

      {canCreate && <CustomerForm />}

      {/* Server-side directory filter (URL search params → listCustomers). Extracted to a
          client component that intercepts submit for no-reload navigation; action="/ledger"
          stays as the no-JS fallback. */}
      <LedgerFilterBar
        q={q ?? ""}
        aging={agingBucket ?? ""}
        outstanding={hasOutstanding}
        agingBuckets={agingBucketOptions}
        isFiltered={isFiltered}
      />

      <DataTable
        columns={columns}
        rows={withAging}
        getRowKey={({ customer: c }) => c.id}
        empty={{
          title: isFiltered ? t("directory.emptyFilteredTitle") : t("directory.emptyTitle"),
          description: isFiltered
            ? t("directory.emptyFilteredDescription")
            : canCreate
              ? t("directory.emptyDescriptionWritable")
              : t("directory.emptyDescriptionReadonly"),
        }}
      />
    </div>
  );
}
