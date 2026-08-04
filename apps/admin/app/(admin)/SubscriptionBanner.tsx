import Link from "next/link";
import type { SubscriptionDTO } from "@hardware/core";

/**
 * Warns the shop before billing bites — never blocks them.
 *
 * A hardware shop's till going dark because a bank transfer is a day late would cost
 * them real money and us the customer, so a lapsed subscription warns loudly and keeps
 * working. Only an explicit suspension by the operator stops sign-in.
 */
export function SubscriptionBanner({ subscription }: { subscription: SubscriptionDTO | null }) {
  if (!subscription || !subscription.needsAttention) return null;

  const { status, daysRemaining, plan } = subscription;
  const tone =
    status === "TRIALING"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
      : "border-destructive/40 bg-destructive/10 text-destructive";

  const message =
    status === "TRIALING"
      ? daysRemaining !== null && daysRemaining > 0
        ? `Your free trial of ${plan.name} ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`
        : `Your free trial of ${plan.name} ends today.`
      : status === "PAST_DUE"
        ? "Your subscription is past due. Everything still works — please renew to keep it that way."
        : "Your subscription has been cancelled. Get in touch to reactivate it.";

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${tone}`} role="status">
      {message}{" "}
      <Link href="/settings/subscription" className="underline underline-offset-2">
        View plan
      </Link>
    </div>
  );
}
