import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listAudit, requirePermission, Forbidden } from "@hardware/core";
import {
  PageHeader,
  ForbiddenState,
  Button,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  formatDateTime,
} from "@hardware/ui";
import { getStaffSession } from "../../../lib/session";
import { AuditFilterBar } from "./AuditFilterBar";

// Audit viewer (S7; audit.read). Append-only log browser (10 §7) — the log is never
// edited or deleted; this is a read-only view. Filter by action / target / date.
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; targetType?: string; from?: string; to?: string; cursor?: string }>;
}) {
  const t = await getTranslations("audit");
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "audit.read");
  } catch (e) {
    if (e instanceof Forbidden) {
      return (
        <div className="space-y-6">
          <ForbiddenState perm="audit.read" />
        </div>
      );
    }
    throw e;
  }

  const sp = await searchParams;
  const page = await listAudit({
    action: sp.action,
    targetType: sp.targetType,
    from: sp.from,
    to: sp.to,
    cursor: sp.cursor,
    limit: 50,
  });

  const qs = (cursor: string) => {
    const p = new URLSearchParams();
    if (sp.action) p.set("action", sp.action);
    if (sp.targetType) p.set("targetType", sp.targetType);
    if (sp.from) p.set("from", sp.from);
    if (sp.to) p.set("to", sp.to);
    p.set("cursor", cursor);
    return `?${p.toString()}`;
  };

  const hasFilters = Boolean(sp.action || sp.targetType || sp.from || sp.to);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <AuditFilterBar
        action={sp.action ?? ""}
        targetType={sp.targetType ?? ""}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
      />

      {page.data.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          description={
            hasFilters
              ? t("empty.descriptionFiltered")
              : t("empty.description")
          }
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link href="/audit">{t("empty.clearFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("table.when")}</TableHead>
                <TableHead>{t("table.action")}</TableHead>
                <TableHead>{t("table.actor")}</TableHead>
                <TableHead>{t("table.target")}</TableHead>
                <TableHead>{t("table.details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.data.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">{r.action}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.actorStaffId ?? (r.roleAtTime === "SYSTEM" ? t("actorSystem") : "—")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.targetType ? `${r.targetType}${r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ""}` : "—"}
                  </TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                    {r.after ? (
                      <span title={JSON.stringify(r.after)}>{JSON.stringify(r.after)}</span>
                    ) : (
                      ""
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page.pageInfo.hasNextPage && page.pageInfo.nextCursor && (
        <div>
          <Button asChild variant="outline">
            <Link href={`/audit${qs(page.pageInfo.nextCursor)}`}>{t("nextPage")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
