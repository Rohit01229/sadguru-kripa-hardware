// Typed-Session helpers (10 §3). Compose the opaque-cookie lookup (sessions.ts)
// with core's permission resolver (resolveSession) to hand transport a fully
// typed `Session` whose `permissions` array the guard (`requirePermission`)
// consumes. Framework-agnostic: the caller passes the cookie VALUE it read from
// `next/headers` cookies(), so @hardware/auth stays free of a hard `next`
// dependency. Thin app wrappers (apps/*/lib/session.ts) read the cookie and
// memoise per request with React `cache()`.
import { resolveSession, resolveCustomerSession, type Session } from "@hardware/core";
import { readStaffSession, readCustomerSession } from "./sessions";

// Re-export the typed Session so apps import it from a single place (@hardware/auth).
export type { Session };

/** Resolve a staff session cookie value → typed Session (with permissions) or null. */
export async function getStaffSession(cookieValue: string | undefined): Promise<Session | null> {
  const staffUserId = await readStaffSession(cookieValue);
  if (!staffUserId) return null;
  return resolveSession(staffUserId);
}

/** Resolve a customer session cookie value → typed Session (ownership-scoped) or null. */
export async function getCustomerSession(
  cookieValue: string | undefined,
): Promise<Session | null> {
  const accountId = await readCustomerSession(cookieValue);
  if (!accountId) return null;
  return resolveCustomerSession(accountId);
}
