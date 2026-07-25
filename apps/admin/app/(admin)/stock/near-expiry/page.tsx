import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { nearExpiry, requirePermission, Forbidden } from "@hardware/core";
import {
  PageHeader,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  formatQty,
  formatDate,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { StockNav, Forbid } from "../nav";
import { NearExpiryFilterBar } from "./NearExpiryFilterBar";

// Near-expiry list (S3): batches expiring within the window (default 30 days) that
// still hold stock, soonest first. Read-only — guarded with stock.read.
export default async function NearExpiryPage({
  searchParams,
}: {
  searchParams: Promise<{ withinDays?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "stock.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="stock.read" />;
    throw e;
  }

  const t = await getTranslations("stock");
  const sp = await searchParams;
  const withinDays = sp.withinDays ? Number(sp.withinDays) : 30;
  const rows = await nearExpiry({ withinDays });

  return (
    <div className="space-y-6">
      <StockNav active="expiry" />

      <PageHeader
        title={t("nearExpiry.title")}
        description={t("nearExpiry.description", { days: withinDays })}
      />

      <NearExpiryFilterBar withinDays={withinDays} />

      {rows.length === 0 ? (
        <EmptyState
          title={t("nearExpiry.emptyTitle")}
          description={t("nearExpiry.emptyDescription", { days: withinDays })}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("nearExpiry.colProduct")}</TableHead>
                <TableHead>{t("nearExpiry.colSku")}</TableHead>
                <TableHead>{t("nearExpiry.colBatch")}</TableHead>
                <TableHead>{t("nearExpiry.colExpiry")}</TableHead>
                <TableHead numeric>{t("nearExpiry.colOnHand")}</TableHead>
                <TableHead numeric>{t("nearExpiry.colDaysLeft")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const expired = b.daysToExpiry <= 0;
                const urgent = b.daysToExpiry > 0 && b.daysToExpiry <= 7;
                return (
                  <TableRow key={b.batchId}>
                    <TableCell className="font-medium">{b.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{b.sku}</TableCell>
                    <TableCell>{b.code}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(b.expiryDate)}</TableCell>
                    <TableCell numeric>{formatQty(b.onHand)}</TableCell>
                    <TableCell numeric>
                      {expired ? (
                        <Badge variant="destructive">{t("nearExpiry.expired")}</Badge>
                      ) : (
                        <Badge variant={urgent ? "destructive" : "warning"}>
                          {t("nearExpiry.daysLeft", { count: b.daysToExpiry })}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
