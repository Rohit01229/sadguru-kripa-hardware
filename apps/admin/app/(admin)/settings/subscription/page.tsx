import Link from "next/link";
import { redirect } from "next/navigation";
import { getSubscription, checkPlanLimit, listPlans } from "@hardware/core";
import { Badge, Card, CardContent, PageHeader, formatMoney, formatDate } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";

// What the shop owner sees about their own plan. Read-only: changing a plan is an
// operator action today (no self-serve billing), so this explains rather than sells.
export default async function SubscriptionPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  const shopId = await requireShopId();

  const [sub, plans, itemLimit, billLimit] = await Promise.all([
    getSubscription(shopId),
    listPlans(),
    checkPlanLimit(shopId, "products"),
    checkPlanLimit(shopId, "invoicesPerMonth"),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Your plan"
        description="What your shop is on, and how much of it you are using."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Your plan" }]}
        linkComponent={Link}
      />

      {!sub ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            This shop has no plan limits.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-base font-semibold">{sub.plan.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {sub.plan.pricePaise === 0 ? "Free" : `${formatMoney(sub.plan.pricePaise)} per month`}
                  </p>
                </div>
                {sub.status === "ACTIVE" && <Badge variant="success">Active</Badge>}
                {sub.status === "TRIALING" && <Badge variant="outline">Trial</Badge>}
                {sub.status === "PAST_DUE" && <Badge variant="destructive">Past due</Badge>}
                {sub.status === "CANCELLED" && <Badge variant="destructive">Cancelled</Badge>}
              </div>
              {sub.status === "TRIALING" && sub.trialEndsAt && (
                <p className="text-sm text-muted-foreground">
                  Trial ends {formatDate(sub.trialEndsAt)}
                  {sub.daysRemaining !== null && ` · ${sub.daysRemaining} days left`}
                </p>
              )}
              {sub.currentPeriodEnd && sub.status !== "TRIALING" && (
                <p className="text-sm text-muted-foreground">
                  Paid up to {formatDate(sub.currentPeriodEnd)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Usage
              </p>
              <Usage label="Items" used={itemLimit.used} limit={itemLimit.limit} />
              <Usage label="Bills this month" used={billLimit.used} limit={billLimit.limit} />
            </CardContent>
          </Card>

          {plans.length > 1 && (
            <p className="text-center text-xs text-muted-foreground">
              Need more? Get in touch and we&apos;ll move you to a bigger plan.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used} {limit === null ? "· unlimited" : `/ ${limit}`}
        </span>
      </div>
      {limit !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={pct >= 90 ? "h-full bg-destructive" : "h-full bg-primary"}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
