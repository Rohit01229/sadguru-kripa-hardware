import { listShops } from "@hardware/core";
import { Badge, Card, CardContent, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, formatDate } from "@hardware/ui";
import { requirePlatformSession } from "../../lib/platform-session";
import { platformLogoutAction } from "./actions";
import { ProvisionShopDialog } from "./ProvisionShopDialog";
import { ShopStatusButton } from "./ShopStatusButton";
import { LogoutButton } from "./LogoutButton";

// Platform console — the super-admin's shop list (16 §4a, §8 P1).
// Guarded by the PLATFORM realm; a shop login cannot reach this page.
export default async function PlatformConsolePage() {
  const session = await requirePlatformSession();
  const shops = await listShops();
  const canManage = session.role === "SUPER_ADMIN";

  const active = shops.filter((s) => s.status === "ACTIVE").length;
  const totalInvoices = shops.reduce((n, s) => n + s.counts.invoices, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Shops"
        description={`Signed in as ${session.email}${canManage ? "" : " (read-only)"}`}
        actions={
          <div className="flex items-center gap-2">
            {canManage && <ProvisionShopDialog />}
            <LogoutButton action={platformLogoutAction} />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Shops</div>
            <div className="text-2xl font-semibold tabular-nums">{shops.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Active</div>
            <div className="text-2xl font-semibold tabular-nums">{active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Invoices raised</div>
            <div className="text-2xl font-semibold tabular-nums">{totalInvoices}</div>
          </CardContent>
        </Card>
      </div>

      {shops.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium">No shops yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first shop to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[52rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Shop</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead numeric>Items</TableHead>
                <TableHead numeric>Bills</TableHead>
                <TableHead numeric>Parties</TableHead>
                <TableHead>Created</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shops.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{s.slug}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{s.ownerName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{s.ownerEmail ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    {s.status === "ACTIVE" ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Suspended</Badge>
                    )}
                  </TableCell>
                  <TableCell numeric>{s.counts.products}</TableCell>
                  <TableCell numeric>{s.counts.invoices}</TableCell>
                  <TableCell numeric>{s.counts.customers}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <ShopStatusButton shopId={s.id} shopName={s.name} status={s.status} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
