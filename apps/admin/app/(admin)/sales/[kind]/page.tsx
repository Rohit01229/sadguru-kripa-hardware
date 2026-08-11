import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  listSalesDocs,
  salesDocCounts,
  SALES_DOC_BY_SLUG,
  SALES_DOC_META,
  requirePermission,
  Forbidden,
  can,
} from "@hardware/core";
import {
  PageHeader,
  Button,
  Card,
  CardContent,
  EmptyState,
  ForbiddenState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
  formatDate,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { SalesNav, SalesDocStatusBadge, SALES_DOC_DESCRIPTION } from "../nav";

// List of one document kind — /sales/estimates | /sales/proforma | /sales/challans.
// One route for all three: they differ by label and by nothing else, so three copies
// would only be three places for a fix to be forgotten.

export default async function SalesDocListPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { kind: slug } = await params;
  const kind = SALES_DOC_BY_SLUG[slug];
  if (!kind) notFound();

  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "bill.read");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="bill.read" />;
    throw e;
  }

  const meta = SALES_DOC_META[kind];
  const shopId = await requireShopId();
  const sp = await searchParams;
  const status =
    sp.status === "OPEN" || sp.status === "CONVERTED" || sp.status === "CANCELLED"
      ? sp.status
      : undefined;

  const [page, counts] = await Promise.all([
    listSalesDocs(shopId, { kind, status, q: sp.q || undefined, limit: 100 }),
    salesDocCounts(shopId, kind),
  ]);
  const mayWrite = can(session, "bill.pakka.create");

  const filters: { key: string; label: string; count: number; href: string }[] = [
    { key: "", label: "All", count: counts.open + counts.converted + counts.cancelled, href: `/sales/${slug}` },
    { key: "OPEN", label: "Open", count: counts.open, href: `/sales/${slug}?status=OPEN` },
    {
      key: "CONVERTED",
      label: "Billed",
      count: counts.converted,
      href: `/sales/${slug}?status=CONVERTED`,
    },
    {
      key: "CANCELLED",
      label: "Cancelled",
      count: counts.cancelled,
      href: `/sales/${slug}?status=CANCELLED`,
    },
  ];

  return (
    <div className="space-y-6">
      <SalesNav active={slug} />
      <PageHeader
        title={meta.plural}
        description={SALES_DOC_DESCRIPTION[kind]}
        actions={
          mayWrite ? (
            <Button asChild>
              <Link href={`/sales/${slug}/new`}>New {meta.label.toLowerCase()}</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f.key || "all"}
            asChild
            size="sm"
            variant={(status ?? "") === f.key ? "default" : "outline"}
          >
            <Link href={f.href}>
              {f.label} <span className="ml-1.5 tabular-nums opacity-70">{f.count}</span>
            </Link>
          </Button>
        ))}
      </div>

      {page.data.length === 0 ? (
        <EmptyState
          title={`No ${meta.plural.toLowerCase()} yet`}
          description={SALES_DOC_DESCRIPTION[kind]}
          action={
            mayWrite ? (
              <Button asChild>
                <Link href={`/sales/${slug}/new`}>New {meta.label.toLowerCase()}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[44rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Number</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead numeric>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.data.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link
                          href={`/sales/${slug}/${d.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {d.docNo}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {d.lines.length} item{d.lines.length === 1 ? "" : "s"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="truncate">{d.customerName ?? "Walk-in"}</div>
                        {d.customerPhone && (
                          <div className="text-xs text-muted-foreground">{d.customerPhone}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(d.date)}</TableCell>
                      <TableCell>
                        <SalesDocStatusBadge status={d.status} expired={d.isExpired} />
                      </TableCell>
                      <TableCell numeric className="font-medium">
                        {formatMoney(d.grandTotal)}
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
