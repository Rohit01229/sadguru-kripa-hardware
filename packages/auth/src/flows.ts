// Auth flows (07 §1, 04 §6 Auth): staff + customer login, customer
// register → email-verify → login, and password reset (request + confirm) for
// both realms. Tokens are single-use, hashed at rest (tokens.ts); responses are
// enumeration-safe. Rate-limit + per-account lockout are applied by the route
// handler / server action that calls these (it owns the request IP); the helpers
// here own the credential + token logic.
import { prisma } from "@hardware/db";
import { hashPassword, verifyPassword } from "./password";
import { issueToken, hashToken } from "./tokens";

export type Realm = "STAFF" | "CUSTOMER";
const EMAIL_VERIFY = "EMAIL_VERIFY";
const PASSWORD_RESET = "PASSWORD_RESET";
const VERIFY_TTL_MIN = 24 * 60; // ~24h (07 §1)
const RESET_TTL_MIN = 45; // 30–60 min (07 §1)

export interface LoginResult {
  ok: boolean;
  userId?: string;
}

/** Verify staff credentials. Returns the userId on success; null otherwise.
 *  Transparently re-hashes if the stored hash is from older argon2 params is a
 *  later refinement (07 §1) — left as a TODO hook, not required for v1 login. */
export async function loginStaff(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.staffUser.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || user.status !== "ACTIVE") return { ok: false };
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false };
  return { ok: true, userId: user.id };
}

/** Verify customer credentials. Requires a verified email before login (07 §1). */
export async function loginCustomer(email: string, password: string): Promise<LoginResult> {
  const account = await prisma.customerAccount.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!account || !account.emailVerified) return { ok: false };
  if (!(await verifyPassword(password, account.passwordHash))) return { ok: false };
  return { ok: true, userId: account.id };
}

export interface RegisterResult {
  accountId: string;
  /** Raw verification token — email it to the user; never stored (only its hash is). */
  verifyToken: string;
}

/**
 * Register a storefront customer: creates the Customer party + CustomerAccount
 * (unverified) and issues an email-verification token. Idempotent-ish: a
 * duplicate email throws a typed error the transport maps to an enumeration-safe
 * response (do not reveal whether the email already exists).
 */
export async function registerCustomer(input: {
  email: string;
  password: string;
  name: string;
  phone?: string;
}): Promise<RegisterResult> {
  const email = input.email.toLowerCase();
  const existing = await prisma.customerAccount.findUnique({ where: { email } });
  if (existing) {
    const err = new Error("EMAIL_TAKEN") as Error & { code?: string };
    err.code = "EMAIL_TAKEN";
    throw err;
  }
  const passwordHash = await hashPassword(input.password);
  const token = issueToken(VERIFY_TTL_MIN);

  const account = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: { name: input.name, phone: input.phone ?? null },
    });
    const acct = await tx.customerAccount.create({
      data: { customerId: customer.id, email, passwordHash },
    });
    await tx.verificationToken.create({
      data: {
        realm: "CUSTOMER",
        subjectId: acct.id,
        purpose: EMAIL_VERIFY,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      },
    });
    return acct;
  });

  return { accountId: account.id, verifyToken: token.token };
}

/** Consume an email-verification token; marks the customer account verified.
 *  Single-use: rejects used/expired/unknown tokens. Returns whether it verified. */
export async function verifyCustomerEmail(rawToken: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const rec = await prisma.verificationToken.findUnique({ where: { tokenHash } });
  if (!rec || rec.purpose !== EMAIL_VERIFY || rec.realm !== "CUSTOMER") return false;
  if (rec.usedAt || rec.expiresAt.getTime() < Date.now()) return false;

  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });
    await tx.customerAccount.update({
      where: { id: rec.subjectId },
      data: { emailVerified: new Date() },
    });
  });
  return true;
}

/**
 * Request a password reset for a realm. ALWAYS resolves (enumeration-safe — the
 * transport returns the same "if an account exists…" message regardless).
 * Returns the raw token to email ONLY when an account actually exists; otherwise
 * null and the transport still responds success. A newer request invalidates
 * older unused reset tokens for the same subject (07 §1).
 */
export async function requestPasswordReset(
  realm: Realm,
  email: string,
): Promise<{ token: string; subjectId: string } | null> {
  const lower = email.toLowerCase();
  const subjectId =
    realm === "STAFF"
      ? (await prisma.staffUser.findUnique({ where: { email: lower }, select: { id: true } }))?.id
      : (await prisma.customerAccount.findUnique({ where: { email: lower }, select: { id: true } }))
          ?.id;
  if (!subjectId) return null;

  const token = issueToken(RESET_TTL_MIN);
  await prisma.$transaction(async (tx) => {
    // Invalidate prior unused reset tokens for this subject.
    await tx.verificationToken.updateMany({
      where: { realm, subjectId, purpose: PASSWORD_RESET, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.verificationToken.create({
      data: {
        realm,
        subjectId,
        purpose: PASSWORD_RESET,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
      },
    });
  });
  return { token: token.token, subjectId };
}

/** Confirm a password reset: validate the single-use token and set the new hash. */
export async function confirmPasswordReset(
  realm: Realm,
  rawToken: string,
  newPassword: string,
): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const rec = await prisma.verificationToken.findUnique({ where: { tokenHash } });
  if (!rec || rec.purpose !== PASSWORD_RESET || rec.realm !== realm) return false;
  if (rec.usedAt || rec.expiresAt.getTime() < Date.now()) return false;

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({ where: { tokenHash }, data: { usedAt: new Date() } });
    if (realm === "STAFF") {
      await tx.staffUser.update({ where: { id: rec.subjectId }, data: { passwordHash } });
      // Revoke all staff sessions on password change (logout-everywhere).
      await tx.staffSession.deleteMany({ where: { staffUserId: rec.subjectId } });
    } else {
      await tx.customerAccount.update({ where: { id: rec.subjectId }, data: { passwordHash } });
      await tx.customerSession.deleteMany({ where: { accountId: rec.subjectId } });
    }
  });
  return true;
}
