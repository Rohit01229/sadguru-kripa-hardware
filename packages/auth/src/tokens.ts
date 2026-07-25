import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// Email-verify / password-reset tokens (07 §1): the raw token is emailed; only
// its SHA-256 hash is stored; single-use; short TTL; constant-time comparison.

export interface IssuedToken {
  token: string; // send to the user, never store
  tokenHash: string; // store this
  expiresAt: Date;
}

export interface TokenRecord {
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueToken(ttlMinutes: number): IssuedToken {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  };
}

export function verifyToken(token: string, record: TokenRecord, now: Date = new Date()): boolean {
  if (record.usedAt) return false;
  if (record.expiresAt.getTime() < now.getTime()) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(record.tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
