"use client";

import { useState, useTransition } from "react";
import type { PlanDTO, SubscriptionDTO } from "@hardware/core";
import { Badge, Button, Card, CardContent, FormField, Input, Select, formatMoney } from "@hardware/ui";
import { assignPlanAction, recordPaymentAction, cancelSubscriptionAction } from "./actions";

/**
 * Plan + billing state for one shop, with the operator actions inline.
 *
 * There is no payment gateway here by design (doc 16 §8 P4): a small operator collects
 * on UPI or bank transfer and records what arrived. "Record payment" writes that ledger
 * entry and extends the paid period.
 */
export function SubscriptionCell({
  shopId,
  shopName,
  subscription,
  plans,
}: {
  shopId: string;
  shopName: string;
  subscription: SubscriptionDTO | null;
  plans: PlanDTO[];
}) {
  const [open, setOpen] = useState<null | "plan" | "pay">(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [planKey, setPlanKey] = useState(subscription?.plan.key ?? plans[0]?.key ?? "FREE");
  const [trialDays, setTrialDays] = useState("14");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [months, setMonths] = useState("1");
  const [reference, setReference] = useState("");

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setError(null);
        setOpen(null);
      }
    });
  }

  const badge = () => {
    if (!subscription) return <Badge variant="outline">No plan</Badge>;
    switch (subscription.status) {
      case "ACTIVE":
        return <Badge variant="success">{subscription.plan.name}</Badge>;
      case "TRIALING":
        return (
          <Badge variant="outline">
            {subscription.plan.name} · trial{" "}
            {subscription.daysRemaining !== null ? `${subscription.daysRemaining}d` : ""}
          </Badge>
        );
      case "PAST_DUE":
        return <Badge variant="destructive">Past due</Badge>;
      default:
        return <Badge variant="destructive">Cancelled</Badge>;
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {badge()}
        <Button size="sm" variant="ghost" onClick={() => setOpen("plan")}>
          Plan
        </Button>
        {subscription && (
          <Button size="sm" variant="ghost" onClick={() => setOpen("pay")}>
            Payment
          </Button>
        )}
      </div>
      {subscription?.currentPeriodEnd && subscription.status !== "CANCELLED" && (
        <div className="text-xs text-muted-foreground">
          Paid to {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN")}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          <Card className="w-full max-w-md">
            <CardContent className="space-y-4 pt-6">
              <div>
                <h2 className="text-base font-semibold">
                  {open === "plan" ? "Change plan" : "Record a payment"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{shopName}</p>
              </div>

              {error && (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              {open === "plan" ? (
                <>
                  <FormField label="Plan">
                    <Select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
                      {plans.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.name} — {p.pricePaise === 0 ? "Free" : `${formatMoney(p.pricePaise)}/mo`}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Trial days" hint="0 for no trial — starts as active.">
                    <Input
                      value={trialDays}
                      onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, ""))}
                      inputMode="numeric"
                    />
                  </FormField>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={pending}
                      onClick={() => run(() => assignPlanAction(shopId, planKey, Number(trialDays) || 0))}
                    >
                      Save plan
                    </Button>
                    <Button variant="outline" onClick={() => setOpen(null)} disabled={pending}>
                      Cancel
                    </Button>
                  </div>
                  {subscription && subscription.status !== "CANCELLED" && (
                    <Button
                      variant="ghost"
                      className="w-full text-destructive"
                      disabled={pending}
                      onClick={() => run(() => cancelSubscriptionAction(shopId))}
                    >
                      Cancel this subscription
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Amount (₹)" required>
                      <Input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        autoFocus
                      />
                    </FormField>
                    <FormField label="Months covered">
                      <Input
                        value={months}
                        onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                      />
                    </FormField>
                    <FormField label="Method">
                      <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                        <option value="UPI">UPI</option>
                        <option value="BANK">Bank transfer</option>
                        <option value="CASH">Cash</option>
                        <option value="OTHER">Other</option>
                      </Select>
                    </FormField>
                    <FormField label="Reference" hint="UTR or note.">
                      <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                    </FormField>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={pending || !amount}
                      onClick={() =>
                        run(() =>
                          recordPaymentAction(shopId, amount, method, Number(months) || 1, reference),
                        )
                      }
                    >
                      Record payment
                    </Button>
                    <Button variant="outline" onClick={() => setOpen(null)} disabled={pending}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
