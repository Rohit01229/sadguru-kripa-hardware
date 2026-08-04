// Store settings (S7; settings.*, 13 §10). The single "default" StoreConfig row
// drives invoices/orders/prints: place-of-supply home state (03 §8), invoice prefix
// (03 §7), delivery fee/threshold (orders), reservation TTL (orders), and the GST
// rounding mode (billing). Read is settings.read; write is settings.write
// (owner-only). Every write is ONE prisma.$transaction, permission-guarded + audited
// in the same tx (10 §7). billing.getStoreConfig already exposes a read for the POS;
// this adds the FULL config read + the guarded write the admin screen needs.
import { Prisma, prisma, runTx } from "../shared/db";
import { audit } from "../shared/audit";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { DomainError } from "../shared/errors";
import { toPaise, fromPaise } from "../shared/money";
import { updateStoreConfigSchema, type UpdateStoreConfigInput } from "./schema";
import { billThemeSchema, readBillTheme, type BillTheme } from "./billTheme";

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

/** Full StoreConfig for the caller's shop (settings.read enforced at transport). Null if not seeded. */
export async function getFullStoreConfig(shopId: string): Promise<FullStoreConfigDTO | null> {
  const s = await prisma.storeConfig.findUnique({ where: { shopId } });
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
  const shopId = requireShop(ctx.session);
  const data = updateStoreConfigSchema.parse(input);

  const updated = await runTx(async (tx) => {
    const before = await tx.storeConfig.findUnique({ where: { shopId } });
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

    const s = await tx.storeConfig.update({ where: { shopId }, data: patch });

    await audit(tx, {
      shopId,
      ...auditMeta(ctx.session),
      permissionUsed: "settings.write",
      action: "settings.update",
      targetType: "StoreConfig",
      targetId: before.id,
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

/**
 * The shop's bill theme (19 §7). Never throws on bad stored JSON — a theme is cosmetic,
 * so a corrupt or future-version blob falls back to the defaults rather than breaking
 * every print. Returns the defaults for a shop that has never opened the editor.
 */
export async function getBillTheme(shopId: string): Promise<BillTheme> {
  const row = await prisma.storeConfig.findUnique({
    where: { shopId },
    select: { billTheme: true },
  });
  return readBillTheme(row?.billTheme ?? null);
}

/**
 * Save the shop's bill theme. Guarded by settings.write (owner-only) and audited in the
 * same transaction as the write, exactly like every other settings change (10 §7).
 * The Zod parse is what makes the stored JSON safe: unknown keys are dropped, numbers
 * clamped, enums closed — so nothing outside the schema can reach the renderer.
 */
export async function updateBillTheme(input: unknown, ctx: SettingsCtx): Promise<BillTheme> {
  requirePermission(ctx.session, "settings.write");
  const shopId = requireShop(ctx.session);
  const theme = billThemeSchema.parse(input);

  await runTx(async (tx) => {
    const before = await tx.storeConfig.findUnique({
      where: { shopId },
      select: { id: true, billTheme: true },
    });
    if (!before) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");

    await tx.storeConfig.update({ where: { shopId }, data: { billTheme: theme } });

    await audit(tx, {
      ...auditMeta(ctx.session),
      shopId,
      permissionUsed: "settings.write",
      action: "settings.billTheme.update",
      targetType: "StoreConfig",
      targetId: before.id,
      before: { billTheme: before.billTheme ?? null },
      after: { billTheme: theme },
      requestId: ctx.requestId,
    });
  });

  return theme;
}

// Re-export the settings Zod surface so transport imports validation from @hardware/core only.
export * from "./schema";
export * from "./billTheme";
