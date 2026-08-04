// Shop provisioning — the super-admin's core action (16 §4a, §8 P1).
//
// Creating a tenant is not "insert a Shop row": a shop that exists but has no
// StoreConfig, no owner and no units is a broken shop the moment someone logs into it.
// So provisioning is ONE transaction that produces a working tenant — shop, settings,
// owner with the OWNER role, and the starter masters — or nothing at all.
//
// Password hashing deliberately lives OUTSIDE this module: @hardware/auth already owns
// argon2 and it imports core, so core importing auth would be a cycle. The caller hashes
// and passes the hash in. That also keeps a plaintext password from ever crossing this
// boundary.
import { Prisma, prisma, runTx } from "../shared/db";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { ensureDefaultMasters } from "../catalog/defaults";

/** Who is acting. Platform users are not scoped to a shop — that is the point. */
export interface PlatformCtx {
  platformUserId: string;
  requestId?: string | null;
}

export interface ProvisionShopInput {
  name: string;
  /** Routing key; lower-cased and validated by the caller's Zod schema. */
  slug: string;
  /** GST state code the shop bills from — drives CGST/SGST vs IGST. */
  homeState: string;
  gstin?: string | null;
  owner: {
    name: string;
    email: string;
    /** Already argon2-hashed by the caller (see module note). */
    passwordHash: string;
  };
}

export interface ProvisionedShop {
  shopId: string;
  slug: string;
  ownerStaffUserId: string;
  ownerEmail: string;
}

/**
 * Create a fully working shop. Atomic: any failure leaves no half-built tenant.
 *
 * Fails loudly on a duplicate slug or owner email rather than silently attaching to an
 * existing record — provisioning the wrong shop to the wrong person is far worse than
 * an error message.
 */
export async function provisionShop(
  input: ProvisionShopInput,
  ctx: PlatformCtx,
): Promise<ProvisionedShop> {
  const slug = input.slug.trim().toLowerCase();
  const email = input.owner.email.trim().toLowerCase();

  // Check before opening the transaction so the common mistakes give a clean message
  // rather than a raw unique-constraint error. The DB constraints below are still the
  // real guarantee against a race.
  const [slugTaken, emailTaken] = await Promise.all([
    prisma.shop.findUnique({ where: { slug }, select: { id: true } }),
    prisma.staffUser.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (slugTaken) throw new DomainError(`The address "${slug}" is already taken.`, "DUP_NAME");
  if (emailTaken) throw new DomainError(`A user with the email ${email} already exists.`, "DUP_NAME");

  try {
    return await runTx(async (tx) => {
      const shop = await tx.shop.create({
        data: { name: input.name.trim(), slug, status: "ACTIVE", plan: "FREE" },
        select: { id: true, slug: true },
      });

      // Settings the billing engine reads on every sale — a shop without this cannot
      // raise an invoice at all, so it is part of provisioning, not a later step.
      await tx.storeConfig.create({
        data: {
          shopId: shop.id,
          name: input.name.trim(),
          homeState: input.homeState,
          gstin: input.gstin?.trim() || null,
        },
      });

      // The OWNER role is global (not per-shop) — the permission matrix is the same
      // everywhere; what differs is the shop the user belongs to.
      const ownerRole = await tx.role.findUnique({ where: { key: "OWNER" }, select: { id: true } });
      if (!ownerRole) {
        throw new DomainError(
          "The OWNER role is missing — run the database seed before provisioning shops.",
          "NOT_FOUND",
        );
      }

      const owner = await tx.staffUser.create({
        data: {
          shopId: shop.id,
          name: input.owner.name.trim(),
          email,
          passwordHash: input.owner.passwordHash,
          status: "ACTIVE",
          roles: { create: { roleId: ownerRole.id } },
        },
        select: { id: true, email: true },
      });

      // Starter units + a "General" category, so the owner can add their first item
      // immediately instead of landing on a set-up screen (19 §4).
      await ensureDefaultMasters(tx, shop.id);

      await audit(tx, {
        shopId: shop.id,
        // Platform users are recorded in the same actor field; roleAtTime distinguishes
        // them from shop staff, so one audit trail covers both realms.
        actorStaffId: ctx.platformUserId,
        roleAtTime: "PLATFORM",
        permissionUsed: "platform.shops.create",
        action: "platform.shop.provisioned",
        targetType: "Shop",
        targetId: shop.id,
        after: { name: input.name, slug, ownerEmail: email },
        requestId: ctx.requestId,
      });

      return {
        shopId: shop.id,
        slug: shop.slug,
        ownerStaffUserId: owner.id,
        ownerEmail: owner.email,
      };
    });
  } catch (e) {
    // A race between the pre-check and the insert lands here.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("That shop address or owner email was just taken.", "DUP_NAME");
    }
    throw e;
  }
}

export interface ShopSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  createdAt: string;
  /** Owner is whoever holds the shop's oldest staff account. */
  ownerName: string | null;
  ownerEmail: string | null;
  counts: { products: number; invoices: number; customers: number; staff: number };
}

/**
 * Every shop with enough signal to run the business: who owns it, and whether it is
 * actually being used. Counts are aggregated per shop rather than N+1 per row.
 */
export async function listShops(): Promise<ShopSummary[]> {
  const shops = await prisma.shop.findMany({ orderBy: { createdAt: "asc" } });
  if (shops.length === 0) return [];
  const ids = shops.map((s) => s.id);

  const [products, invoices, customers, staff, owners] = await Promise.all([
    prisma.product.groupBy({ by: ["shopId"], where: { shopId: { in: ids } }, _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ["shopId"], where: { shopId: { in: ids } }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["shopId"], where: { shopId: { in: ids } }, _count: { _all: true } }),
    prisma.staffUser.groupBy({ by: ["shopId"], where: { shopId: { in: ids } }, _count: { _all: true } }),
    prisma.staffUser.findMany({
      where: { shopId: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: { shopId: true, name: true, email: true },
    }),
  ]);

  const countOf = (rows: { shopId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.shopId === id)?._count._all ?? 0;
  // First staff account per shop = the owner it was provisioned with.
  const ownerOf = new Map<string, { name: string; email: string }>();
  for (const o of owners) if (!ownerOf.has(o.shopId)) ownerOf.set(o.shopId, o);

  return shops.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    status: s.status,
    plan: s.plan,
    createdAt: s.createdAt.toISOString(),
    ownerName: ownerOf.get(s.id)?.name ?? null,
    ownerEmail: ownerOf.get(s.id)?.email ?? null,
    counts: {
      products: countOf(products, s.id),
      invoices: countOf(invoices, s.id),
      customers: countOf(customers, s.id),
      staff: countOf(staff, s.id),
    },
  }));
}

/**
 * Suspend or re-activate a shop.
 *
 * SUSPENDED is a soft state by design: the tenant's data is untouched and its staff
 * simply cannot sign in. Deleting a shop would destroy invoices a business is legally
 * required to retain, so there is no delete here at all.
 */
export async function setShopStatus(
  shopId: string,
  status: "ACTIVE" | "SUSPENDED",
  ctx: PlatformCtx,
): Promise<ShopSummary> {
  await runTx(async (tx) => {
    const before = await tx.shop.findUnique({ where: { id: shopId }, select: { status: true } });
    if (!before) throw new DomainError("Shop not found.", "NOT_FOUND");

    await tx.shop.update({ where: { id: shopId }, data: { status } });

    // Revoking sessions is what makes suspension take effect NOW rather than whenever
    // the current session happens to expire.
    if (status === "SUSPENDED") {
      const staff = await tx.staffUser.findMany({ where: { shopId }, select: { id: true } });
      await tx.staffSession.deleteMany({ where: { staffUserId: { in: staff.map((s) => s.id) } } });
    }

    await audit(tx, {
      shopId,
      actorStaffId: ctx.platformUserId,
      roleAtTime: "PLATFORM",
      permissionUsed: "platform.shops.suspend",
      action: status === "SUSPENDED" ? "platform.shop.suspended" : "platform.shop.activated",
      targetType: "Shop",
      targetId: shopId,
      before: { status: before.status },
      after: { status },
      requestId: ctx.requestId,
    });
  });

  const summary = (await listShops()).find((s) => s.id === shopId);
  if (!summary) throw new DomainError("Shop not found.", "NOT_FOUND");
  return summary;
}

/** Resolve a platform user for the session layer. Null when missing or disabled. */
export async function resolvePlatformUser(platformUserId: string) {
  const user = await prisma.platformUser.findUnique({
    where: { id: platformUserId },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return user;
}
