// Store settings (S7; settings.*, 13 §10). The single "default" StoreConfig row
// drives invoices/orders/prints: place-of-supply home state (03 §8), invoice prefix
// (03 §7), delivery fee/threshold (orders), reservation TTL (orders), and the GST
// rounding mode (billing). Read is settings.read; write is settings.write
// (owner-only). Every write is ONE prisma.$transaction, permission-guarded + audited
// in the same tx (10 §7). billing.getStoreConfig already exposes a read for the POS;
// this adds the FULL config read + the guarded write the admin screen needs.
import { Prisma, prisma, runTx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise, fromPaise } from "../shared/money";
import { updateStoreConfigSchema, type UpdateStoreConfigInput } from "./schema";

export interface SettingsCtx {
  session: Session;
  requestId?: string | null;
}

function auditMeta(session: Session) {
  return { actorStaffId: session.userId, roleAtTime: session.roles?.[0] ?? null };
}

/** A 2dp Prisma Decimal (money is @db.Decimal(14,2)). */
function money2(paiseValue: number): Prisma.Decimal {
  return new Prisma.Decimal(fromPaise(paiseValue).toFixed(2));
}

export interface FullStoreConfigDTO {
  id: string;
  name: string;
  gstin: string | null;
  homeState: string;
  address: string | null;
  logoKey: string | null;
  bankDetails: string | null;
  invoiceTerms: string | null;
  invoicePrefixFormat: string;
  deliveryFlatFee: number; // paise
  freeDeliveryThreshold: number | null; // paise
  reservationTtlMinutes: number;
  gstRoundingMode: string;
}

function toDTO(s: {
  id: string;
  name: string;
  gstin: string | null;
  homeState: string;
  address: string | null;
  logoKey: string | null;
  bankDetails: string | null;
  invoiceTerms: string | null;
  invoicePrefixFormat: string;
  deliveryFlatFee: Prisma.Decimal;
  freeDeliveryThreshold: Prisma.Decimal | null;
  reservationTtlMinutes: number;
  gstRoundingMode: string;
}): FullStoreConfigDTO {
  return {
    id: s.id,
    name: s.name,
    gstin: s.gstin,
    homeState: s.homeState,
    address: s.address,
    logoKey: s.logoKey,
    bankDetails: s.bankDetails,
    invoiceTerms: s.invoiceTerms,
    invoicePrefixFormat: s.invoicePrefixFormat,
    deliveryFlatFee: toPaise(s.deliveryFlatFee),
    freeDeliveryThreshold: s.freeDeliveryThreshold === null ? null : toPaise(s.freeDeliveryThreshold),
    reservationTtlMinutes: s.reservationTtlMinutes,
    gstRoundingMode: s.gstRoundingMode,
  };
}

/** Full StoreConfig (settings.read enforced at transport). Null if not seeded. */
export async function getFullStoreConfig(): Promise<FullStoreConfigDTO | null> {
  const s = await prisma.storeConfig.findUnique({ where: { id: "default" } });
  return s ? toDTO(s) : null;
}

/**
 * Update the "default" StoreConfig (settings.write, owner-only). PARTIAL patch — only
 * the supplied fields change; the rest are untouched. ONE transaction: load the
 * before-snapshot, apply, audit (with before/after so a settings change is itself
 * auditable — 10 §7). Money fields arrive as paise and are stored as rupee Decimals.
 */
export async function updateStoreConfig(
  input: UpdateStoreConfigInput,
  ctx: SettingsCtx,
): Promise<FullStoreConfigDTO> {
  requirePermission(ctx.session, "settings.write");
  const data = updateStoreConfigSchema.parse(input);

  const updated = await runTx(async (tx) => {
    const before = await tx.storeConfig.findUnique({ where: { id: "default" } });
    if (!before) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");

    const patch: Prisma.StoreConfigUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.gstin !== undefined) patch.gstin = data.gstin;
    if (data.homeState !== undefined) patch.homeState = data.homeState;
    if (data.address !== undefined) patch.address = data.address;
    if (data.logoKey !== undefined) patch.logoKey = data.logoKey;
    if (data.bankDetails !== undefined) patch.bankDetails = data.bankDetails;
    if (data.invoiceTerms !== undefined) patch.invoiceTerms = data.invoiceTerms;
    if (data.invoicePrefixFormat !== undefined) patch.invoicePrefixFormat = data.invoicePrefixFormat;
    if (data.deliveryFlatFee !== undefined) patch.deliveryFlatFee = money2(data.deliveryFlatFee);
    if (data.freeDeliveryThreshold !== undefined)
      patch.freeDeliveryThreshold = data.freeDeliveryThreshold === null ? null : money2(data.freeDeliveryThreshold);
    if (data.reservationTtlMinutes !== undefined) patch.reservationTtlMinutes = data.reservationTtlMinutes;
    if (data.gstRoundingMode !== undefined) patch.gstRoundingMode = data.gstRoundingMode;

    const s = await tx.storeConfig.update({ where: { id: "default" }, data: patch });

    await audit(tx, {
      ...auditMeta(ctx.session),
      permissionUsed: "settings.write",
      action: "settings.update",
      targetType: "StoreConfig",
      targetId: "default",
      before: {
        name: before.name,
        gstin: before.gstin,
        homeState: before.homeState,
        gstRoundingMode: before.gstRoundingMode,
        invoicePrefixFormat: before.invoicePrefixFormat,
      },
      after: { changedKeys: Object.keys(patch) },
      requestId: ctx.requestId,
    });

    return s;
  });

  return toDTO(updated);
}

// Re-export the settings Zod surface so transport imports validation from @hardware/core only.
export * from "./schema";
