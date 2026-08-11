import { Forbidden } from "./errors";

// Source-of-truth permission keys (10-rbac.md §4). Seeded into the DB; guards
// check these, never role names ("never branch on role" — 10 §6).
export const PERMISSIONS = [
  "products.read",
  "products.create",
  "products.update",
  "products.archive",
  "units.manage",
  "pricing.read",
  "pricing.write",
  "stock.read",
  "stock.grn",
  "stock.adjust",
  "stock.returns",
  "suppliers.read",
  "suppliers.write",
  "bill.kacha.create",
  "bill.pakka.create",
  "bill.read",
  "bill.cancel",
  "bill.creditnote.create",
  "customers.read",
  "customers.write",
  "ledger.read",
  "ledger.write",
  // Shop money-OUT (21b). Deliberately its own pair rather than reusing ledger.*:
  // customer khata and the owner's rent/salary bills are different sensitivities, and a
  // counter role that needs to see a customer's dues should not thereby see payroll.
  "expenses.read",
  "expenses.write",
  "orders.read",
  "orders.fulfil",
  "orders.place",
  "orders.cancel.own",
  "import.catalog",
  "reports.read",
  "reports.export",
  "settings.read",
  "settings.write",
  "users.manage",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Realm = "STAFF" | "CUSTOMER";

export interface Session {
  userId: string;
  realm: Realm;
  /**
   * The tenant (shop) this principal is scoped to (17 — multi-tenancy). Every core
   * service that touches business data resolves it via {@link requireShop}, so a
   * request can only ever read/write its own shop's rows. Optional on the type (the
   * platform realm and mid-transition rows may lack it) but REQUIRED in practice for
   * any STAFF/CUSTOMER action — `requireShop` throws when it is missing.
   */
  shopId?: string;
  /** Role keys held by the principal (e.g. ["OWNER"]); used for `roleAtTime` in audit, never for branching. */
  roles?: readonly string[];
  /** For CUSTOMER sessions: the Customer party id this account belongs to (ownership checks). */
  customerId?: string;
  /** Permission keys resolved from the user's roles (resolution happens in the data layer). */
  permissions: readonly string[];
}

export function can(session: Session, permission: Permission): boolean {
  return session.permissions.includes(permission);
}

export function requirePermission(session: Session, permission: Permission): void {
  if (!can(session, permission)) {
    throw new Forbidden(permission);
  }
}

/**
 * Resolve the caller's shop id or refuse (17 — multi-tenancy). Call ONCE at the top
 * of every service that reads or writes tenant data, then thread the returned
 * `shopId` into every `where`/`data`. A session with no shop can never touch business
 * rows — the single choke-point that makes cross-tenant access impossible.
 */
export function requireShop(session: Session): string {
  if (!session.shopId) throw new Forbidden("shop-scope");
  return session.shopId;
}
