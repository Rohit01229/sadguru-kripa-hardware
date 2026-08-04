// First-run onboarding (16 §6).
//
// A shop provisioned by the super-admin arrives with settings, an owner and starter
// units — but no items and no bills. Dropping that owner onto an empty dashboard is the
// exact "too hard to use" complaint that started this pivot, so their first sign-in
// routes them through three steps instead: confirm the shop, add a few items, make a
// bill.
//
// `onboardedAt` is an EXPLICIT stamp rather than something inferred from "has products".
// Inferring would re-nag a shop that deliberately skipped, and would silently re-trigger
// if someone ever archived their whole catalogue.
import { prisma, runTx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";

export interface OnboardingCtx {
  session: Session;
  requestId?: string | null;
}

export interface OnboardingState {
  /** True while the wizard should still be shown. */
  pending: boolean;
  completedAt: string | null;
  /** Live progress, so the wizard can tick steps off as they are actually done. */
  progress: {
    /** Shop name, state and GSTIN present. */
    detailsComplete: boolean;
    itemCount: number;
    invoiceCount: number;
  };
}

/**
 * Where this shop is in first-run setup. Cheap enough to call on a page render — three
 * counts and one row.
 */
export async function getOnboardingState(shopId: string): Promise<OnboardingState> {
  const [config, itemCount, invoiceCount] = await Promise.all([
    prisma.storeConfig.findUnique({
      where: { shopId },
      select: { onboardedAt: true, name: true, homeState: true, gstin: true },
    }),
    prisma.product.count({ where: { shopId, isActive: true } }),
    prisma.invoice.count({ where: { shopId } }),
  ]);

  return {
    // No StoreConfig at all shouldn't happen post-provisioning, but treat it as pending
    // rather than crashing — the wizard is exactly where such a shop should land.
    pending: !config?.onboardedAt,
    completedAt: config?.onboardedAt?.toISOString() ?? null,
    progress: {
      // GSTIN is genuinely optional (a small shop may not be registered), so it does not
      // gate completeness — name and state do, because billing cannot work without them.
      detailsComplete: Boolean(config?.name?.trim() && config?.homeState?.trim()),
      itemCount,
      invoiceCount,
    },
  };
}

/**
 * Finish first-run setup. Idempotent — a second call leaves the original timestamp
 * alone, so "when did this shop get going?" stays answerable.
 *
 * `skipped` only changes what we record in the audit trail: either way the wizard stops
 * appearing, because an owner who dismissed it should not be shown it again tomorrow.
 */
export async function completeOnboarding(
  ctx: OnboardingCtx,
  opts: { skipped?: boolean } = {},
): Promise<OnboardingState> {
  requirePermission(ctx.session, "settings.write");
  const shopId = requireShop(ctx.session);

  await runTx(async (tx) => {
    const config = await tx.storeConfig.findUnique({
      where: { shopId },
      select: { id: true, onboardedAt: true },
    });
    if (!config) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");
    if (config.onboardedAt) return; // already done — leave the original timestamp

    await tx.storeConfig.update({ where: { shopId }, data: { onboardedAt: new Date() } });

    await audit(tx, {
      shopId,
      actorStaffId: ctx.session.userId,
      roleAtTime: ctx.session.roles?.[0] ?? null,
      permissionUsed: "settings.write",
      action: opts.skipped ? "onboarding.skipped" : "onboarding.completed",
      targetType: "StoreConfig",
      targetId: config.id,
      after: { skipped: Boolean(opts.skipped) },
      requestId: ctx.requestId,
    });
  });

  return getOnboardingState(shopId);
}
