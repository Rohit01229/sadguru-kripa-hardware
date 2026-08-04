// Platform / tenant resolution (17 — multi-tenancy). Reads over the Shop root.
// P0 needs only reads: list shops (for system jobs that fan out per tenant),
// resolve a shop by slug (future subdomain/path routing), and resolve the single
// "active" shop for code that has no session to carry a shopId (pre-auth branding
// on the login page, and the public storefront). P1 (super-admin) adds create /
// suspend / assign-owner here.
import { prisma } from "../shared/db";

export interface ShopRef {
  id: string;
  name: string;
  slug: string;
  status: string;
}

const shopSelect = { id: true, name: true, slug: true, status: true } as const;

/**
 * All ACTIVE shops, oldest first. System jobs (crons) loop this to run per tenant;
 * the platform console lists it. Not permission-gated here — callers are either the
 * cron realm (CRON_SECRET) or the future platform realm.
 */
export async function listActiveShops(): Promise<ShopRef[]> {
  return prisma.shop.findMany({
    where: { status: "ACTIVE" },
    select: shopSelect,
    orderBy: { createdAt: "asc" },
  });
}

/** Resolve a shop by its slug — the routing key for subdomains/paths (P4). */
export async function getShopBySlug(slug: string): Promise<ShopRef | null> {
  return prisma.shop.findUnique({ where: { slug }, select: shopSelect });
}

/**
 * The shop to use when there is NO session to carry a shopId — pre-auth branding
 * (login page, root layout) and the public storefront (17 §6). For P0 there is one
 * shop, so this resolves it: `DEFAULT_SHOP_SLUG` if set, else the oldest active shop.
 * When multi-shop + per-shop subdomains land (P4), replace these call sites with
 * host-based resolution (`getShopBySlug(hostToSlug(req.host))`); this stays as the
 * single-tenant fallback.
 */
export async function getPrimaryShopId(): Promise<string | null> {
  const slug = process.env.DEFAULT_SHOP_SLUG;
  if (slug) {
    const bySlug = await prisma.shop.findUnique({ where: { slug }, select: { id: true } });
    if (bySlug) return bySlug.id;
  }
  const first = await prisma.shop.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}
