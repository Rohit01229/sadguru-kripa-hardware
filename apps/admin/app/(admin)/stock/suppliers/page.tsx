import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listSuppliers, requirePermission, can, Forbidden } from "@hardware/core";
import {
  PageHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
} from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { StockNav, Forbid } from "../nav";
import { SupplierForm } from "./SupplierForm";

// Supplier directory (S3): list + create. Create needs suppliers.write; the form
// is hidden without it (cosmetic) and the action re-checks server-side.
export default async function SuppliersPage({
  searchParams,
}: {
  /** `?highlight=<id>` — arrived here from the parties directory (21d). */
  searchParams: Promise<{ highlight?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "suppliers.read");
  } catch (e) {
    if (e instanceof Forbidden) return <Forbid perm="suppliers.read" />;
    throw e;
  }

  const t = await getTranslations("stock");
  const shopId = await requireShopId();
  const suppliers = await listSuppliers(shopId);
  const canWrite = can(session, "suppliers.write");
  // Clicking a supplier in the parties directory lands here; mark the row so the eye
  // finds it instead of re-scanning the list. A link that says "this one" and then
  // shows an undifferentiated table is worse than no link.
  const { highlight } = await searchParams;

  return (
    <div className="space-y-6">
      <StockNav active="suppliers" />

      <PageHeader
        title={t("suppliers.title")}
        description={t("suppliers.description")}
      />

      {canWrite && <SupplierForm />}

      {suppliers.length === 0 ? (
        <EmptyState
          title={t("suppliers.emptyTitle")}
          description={
            canWrite
              ? t("suppliers.emptyWritable")
              : t("suppliers.emptyReadonly")
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("suppliers.colName")}</TableHead>
                <TableHead>{t("suppliers.colGstin")}</TableHead>
                <TableHead>{t("suppliers.colPhone")}</TableHead>
                <TableHead>{t("suppliers.colAddress")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow
                  key={s.id}
                  id={`supplier-${s.id}`}
                  className={s.id === highlight ? "bg-primary/10" : undefined}
                >
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.gstin ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.phone ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{s.address ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
