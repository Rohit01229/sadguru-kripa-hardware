// Plans, subscriptions and limit enforcement (16 §8 P4).
//
// ENFORCEMENT PHILOSOPHY, decided deliberately: we never block a shopkeeper mid-sale
// over billing. A shop past its renewal date keeps billing customers and shows a banner;
// only an explicit suspension by the operator (P1) stops sign-in. Count limits DO refuse
// — but they refuse the *next* item or bill with a clear message, never an in-progress
// one, and a shop can always still finish what it started.
//
// Cutting off a hardware shop's till because a bank transfer is a day late would cost
// them real money and us the customer. Warn loudly; suspend manually; never surprise.
import { prisma, runTx } from "../shared/db";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import type { PlatformCtx } from "./provision";

/** Feature switches a plan can carry. Unknown keys are ignored, so adding one is free. */
export interface PlanFeatures {
  storefront?: boolean;
  einvoice?: boolean;
  billTheme?: boolean;
  multiUser?: boolean;
}

export interface PlanDTO {
  id: string;
  key: string;
  name: string;
  pricePaise: number;
  /** null = unlimited. */
  maxProducts: number | null;
  maxInvoicesPerMonth: number | null;
  maxStaff: number | null;
  features: PlanFeatures;
  isActive: boolean;
  sortOrder: number;
}

function toPlanDTO(p: {
  id: string; key: string; name: string; pricePaise: number;
  maxProducts: number | null; maxInvoicesPerMonth: number | null; maxStaff: number | null;
  features: unknown; isActive: boolean; sortOrder: number;
}): PlanDTO {
  return {
    ...p,
    features: (p.features && typeof p.features === "object" ? p.features : {}) as PlanFeatures,
  };
}

export async function listPlans(includeInactive = false): Promise<PlanDTO[]> {
  const rows = await prisma.plan.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { pricePaise: "asc" }],
  });
  return rows.map(toPlanDTO);
}

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

export interface SubscriptionDTO {
  id: string;
  shopId: string;
  plan: PlanDTO;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  notes: string | null;
  /** Days until the trial or paid period runs out; negative when already past. */
  daysRemaining: number | null;
  /** True while the shop should see a "renew" banner. */
  needsAttention: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive the live status rather than trusting the stored one, so a subscription that
 * quietly ran out yesterday reports PAST_DUE without a cron having to sweep it.
 * CANCELLED is terminal and always wins.
 */
function deriveStatus(row: {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}, now: Date): { status: SubscriptionStatus; expiresAt: Date | null } {
  if (row.status === "CANCELLED") return { status: "CANCELLED", expiresAt: null };

  const onTrial = row.trialEndsAt && row.trialEndsAt.getTime() > now.getTime();
  if (onTrial) return { status: "TRIALING", expiresAt: row.trialEndsAt };

  // No paid period at all → whatever the trial left behind is now overdue.
  if (!row.currentPeriodEnd) {
    return { status: row.trialEndsAt ? "PAST_DUE" : "ACTIVE", expiresAt: row.trialEndsAt };
  }
  const paidUp = row.currentPeriodEnd.getTime() > now.getTime();
  return { status: paidUp ? "ACTIVE" : "PAST_DUE", expiresAt: row.currentPeriodEnd };
}

/**
 * The shop's subscription. Returns null when it has none — treated everywhere as
 * "unlimited", so an existing shop keeps working until someone assigns it a plan.
 */
export async function getSubscription(shopId: string, now = new Date()): Promise<SubscriptionDTO | null> {
  const row = await prisma.subscription.findUnique({ where: { shopId }, include: { plan: true } });
  if (!row) return null;

  const { status, expiresAt } = deriveStatus(row, now);
  const daysRemaining = expiresAt
    ? Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS)
    : null;

  return {
    id: row.id,
    shopId: row.shopId,
    plan: toPlanDTO(row.plan),
    status,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    notes: row.notes,
    daysRemaining,
    // Warn while the trial is nearly out, or once a payment is overdue.
    needsAttention:
      status === "PAST_DUE" ||
      status === "CANCELLED" ||
      (status === "TRIALING" && daysRemaining !== null && daysRemaining <= 7),
  };
}

// ─────────────────── Limits ───────────────────

export type LimitKind = "products" | "invoicesPerMonth" | "staff";

export interface LimitCheck {
  allowed: boolean;
  /** null = unlimited. */
  limit: number | null;
  used: number;
  planName?: string;
  message?: string;
}

/**
 * Is this shop under its plan's limit for `kind`?
 *
 * A shop with no subscription is unlimited — we never retro-break a tenant that predates
 * billing. Only counted limits refuse; status (trial, past due) never does, per the
 * philosophy at the top of this file.
 */
export async function checkPlanLimit(shopId: string, kind: LimitKind): Promise<LimitCheck> {
  const sub = await prisma.subscription.findUnique({ where: { shopId }, include: { plan: true } });
  if (!sub) return { allowed: true, limit: null, used: 0 };

  const limit =
    kind === "products"
      ? sub.plan.maxProducts
      : kind === "invoicesPerMonth"
        ? sub.plan.maxInvoicesPerMonth
        : sub.plan.maxStaff;
  if (limit === null || limit === undefined) return { allowed: true, limit: null, used: 0 };

  let used: number;
  if (kind === "products") {
    used = await prisma.product.count({ where: { shopId, isActive: true } });
  } else if (kind === "staff") {
    used = await prisma.staffUser.count({ where: { shopId, status: "ACTIVE" } });
  } else {
    // Calendar month to date — the same window a shopkeeper thinks in.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    used = await prisma.invoice.count({ where: { shopId, date: { gte: monthStart } } });
  }

  const allowed = used < limit;
  return {
    allowed,
    limit,
    used,
    planName: sub.plan.name,
    message: allowed
      ? undefined
      : kind === "invoicesPerMonth"
        ? `Your ${sub.plan.name} plan allows ${limit} bills a month and you have made ${used}. Upgrade to keep billing.`
        : kind === "products"
          ? `Your ${sub.plan.name} plan allows ${limit} items and you have ${used}. Upgrade to add more.`
          : `Your ${sub.plan.name} plan allows ${limit} users and you have ${used}.`,
  };
}

/** Throwing form for service call sites. */
export async function assertWithinPlan(shopId: string, kind: LimitKind): Promise<void> {
  const check = await checkPlanLimit(shopId, kind);
  if (!check.allowed) throw new DomainError(check.message ?? "Plan limit reached.", "VALIDATION");
}

/** Is a feature switched on for this shop? Absent subscription ⇒ everything on. */
export async function hasFeature(shopId: string, feature: keyof PlanFeatures): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { shopId }, include: { plan: true } });
  if (!sub) return true;
  const f = (sub.plan.features ?? {}) as PlanFeatures;
  // Undefined means "not restricted by this plan", not "off".
  return f[feature] !== false;
}

// ─────────────────── Operator actions ───────────────────

/** Assign (or change) a shop's plan. Starts a trial when one is given. */
export async function assignPlan(
  args: { shopId: string; planKey: string; trialDays?: number; notes?: string | null },
  ctx: PlatformCtx,
): Promise<SubscriptionDTO> {
  const plan = await prisma.plan.findUnique({ where: { key: args.planKey } });
  if (!plan) throw new DomainError(`No plan with key ${args.planKey}.`, "NOT_FOUND");

  const trialEndsAt =
    args.trialDays && args.trialDays > 0
      ? new Date(Date.now() + args.trialDays * DAY_MS)
      : undefined;

  await runTx(async (tx) => {
    const before = await tx.subscription.findUnique({ where: { shopId: args.shopId } });
    await tx.subscription.upsert({
      where: { shopId: args.shopId },
      create: {
        shopId: args.shopId,
        planId: plan.id,
        status: trialEndsAt ? "TRIALING" : "ACTIVE",
        trialEndsAt: trialEndsAt ?? null,
        notes: args.notes ?? null,
      },
      update: {
        planId: plan.id,
        // Changing plan clears a cancellation — the operator is reinstating them.
        status: trialEndsAt ? "TRIALING" : "ACTIVE",
        cancelledAt: null,
        ...(trialEndsAt ? { trialEndsAt } : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
      },
    });

    await audit(tx, {
      shopId: args.shopId,
      actorStaffId: ctx.platformUserId,
      roleAtTime: "PLATFORM",
      permissionUsed: "platform.billing.assignPlan",
      action: "platform.subscription.planAssigned",
      targetType: "Subscription",
      targetId: args.shopId,
      before: before ? { planId: before.planId, status: before.status } : null,
      after: { planKey: plan.key, trialDays: args.trialDays ?? 0 },
      requestId: ctx.requestId,
    });
  });

  return (await getSubscription(args.shopId))!;
}

/**
 * Record money received, and extend the paid period.
 *
 * The new period starts from whichever is later: the current period end (so paying early
 * adds time rather than losing it) or today (so a lapsed shop is not credited for the
 * gap it did not pay for).
 */
export async function recordSubscriptionPayment(
  args: {
    shopId: string;
    amountPaise: number;
    method: string;
    reference?: string | null;
    months?: number;
    paidAt?: Date;
  },
  ctx: PlatformCtx,
): Promise<SubscriptionDTO> {
  const months = args.months && args.months > 0 ? Math.floor(args.months) : 1;
  const paidAt = args.paidAt ?? new Date();

  await runTx(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { shopId: args.shopId } });
    if (!sub) throw new DomainError("Assign a plan before recording a payment.", "NOT_FOUND");

    const base =
      sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > paidAt.getTime()
        ? sub.currentPeriodEnd
        : paidAt;
    const periodEnd = new Date(base);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + months);

    await tx.subscriptionPayment.create({
      data: {
        shopId: args.shopId,
        subscriptionId: sub.id,
        amountPaise: args.amountPaise,
        method: args.method,
        reference: args.reference ?? null,
        paidAt,
        periodStart: base,
        periodEnd,
        recordedById: ctx.platformUserId,
      },
    });

    await tx.subscription.update({
      where: { id: sub.id },
      // Paying ends the trial: they are now a paying customer, not a prospect.
      data: { currentPeriodEnd: periodEnd, status: "ACTIVE", trialEndsAt: null, cancelledAt: null },
    });

    await audit(tx, {
      shopId: args.shopId,
      actorStaffId: ctx.platformUserId,
      roleAtTime: "PLATFORM",
      permissionUsed: "platform.billing.recordPayment",
      action: "platform.subscription.paymentRecorded",
      targetType: "Subscription",
      targetId: sub.id,
      after: { amountPaise: args.amountPaise, method: args.method, periodEnd: periodEnd.toISOString() },
      requestId: ctx.requestId,
    });
  });

  return (await getSubscription(args.shopId))!;
}

/** Cancel a subscription. Does NOT suspend the shop — that stays a separate decision. */
export async function cancelSubscription(
  shopId: string,
  ctx: PlatformCtx,
): Promise<SubscriptionDTO> {
  await runTx(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { shopId } });
    if (!sub) throw new DomainError("This shop has no subscription.", "NOT_FOUND");
    await tx.subscription.update({
      where: { id: sub.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await audit(tx, {
      shopId,
      actorStaffId: ctx.platformUserId,
      roleAtTime: "PLATFORM",
      permissionUsed: "platform.billing.cancel",
      action: "platform.subscription.cancelled",
      targetType: "Subscription",
      targetId: sub.id,
      requestId: ctx.requestId,
    });
  });
  return (await getSubscription(shopId))!;
}

/** Payment history for a shop, newest first. */
export async function listSubscriptionPayments(shopId: string, limit = 24) {
  const rows = await prisma.subscriptionPayment.findMany({
    where: { shopId },
    orderBy: { paidAt: "desc" },
    take: limit,
  });
  return rows.map((p) => ({
    id: p.id,
    amountPaise: p.amountPaise,
    method: p.method,
    reference: p.reference,
    paidAt: p.paidAt.toISOString(),
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
  }));
}
