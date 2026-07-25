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
