// Session → permission resolution (10 §3, §5). The guard (`can`/`requirePermission`
// in rbac.ts) consumes a `Session` whose `permissions` array is the UNION of every
// permission granted by the user's roles. We resolve UserRole → Role →
// RolePermission → Permission.key here, in the data layer, so code never branches
// on role name (10 §6).
import { prisma } from "./db";
import type { Session } from "./rbac";

/**
 * Load a staff user's effective permission set and return a typed Session.
 * Returns `null` if the user does not exist or is not ACTIVE (a disabled owner
 * must not retain authority). Per-request caching is the transport layer's job
 * (wrap this in React `cache()` — see @hardware/auth getStaffSession), keeping
 * core framework-free (03 §1).
 */
export async function resolveSession(staffUserId: string): Promise<Session | null> {
  const user = await prisma.staffUser.findUnique({
    where: { id: staffUserId },
    select: {
      id: true,
      status: true,
      roles: {
        select: {
          role: {
            select: {
              key: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });

  if (!user || user.status !== "ACTIVE") return null;

  const permissions = new Set<string>();
  const roleKeys: string[] = [];
  for (const ur of user.roles) {
    roleKeys.push(ur.role.key);
    for (const rp of ur.role.permissions) {
      permissions.add(rp.permission.key);
    }
  }

  return {
    userId: user.id,
    realm: "STAFF",
    roles: roleKeys,
    permissions: [...permissions],
  };
}

/**
 * The Customer realm's intrinsic permission set (10 §2.3, §4). The Customer is a
 * SEPARATE axis from the staff role matrix: these are the only capabilities a
 * storefront account ever holds, and each is "own-resource only" — every one is
 * additionally gated by an OWNERSHIP check in the service against
 * `session.customerId` (10 §5). We attach them here so transport/core use the SAME
 * `requirePermission(session, key)` guard for everyone (never branch on realm/role —
 * 10 §6); the ownership scope is what makes them safe, not the matrix.
 */
export const CUSTOMER_PERMISSIONS = [
  "products.read",
  "pricing.read",
  "orders.place",
  "orders.read", // own only — service scopes by customerId
  "orders.cancel.own",
  "ledger.read", // own only — service scopes by customerId
] as const;

/**
 * Resolve a storefront customer into a Session. Customers carry NO staff
 * permissions (10 §2.3); they hold the intrinsic, ownership-scoped CUSTOMER set
 * above. Their authority is enforced by ownership checks in the service, never the
 * staff matrix. The realm is CUSTOMER so a customer session can never satisfy a
 * staff-only endpoint and vice-versa (hard boundary — 10 §2.3).
 */
export async function resolveCustomerSession(accountId: string): Promise<Session | null> {
  const account = await prisma.customerAccount.findUnique({
    where: { id: accountId },
    select: { id: true, customerId: true, emailVerified: true },
  });
  if (!account || !account.emailVerified) return null;
  return {
    userId: account.id,
    customerId: account.customerId,
    realm: "CUSTOMER",
    roles: ["CUSTOMER"],
    permissions: [...CUSTOMER_PERMISSIONS],
  };
}
