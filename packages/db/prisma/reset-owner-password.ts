// One-off: reset the owner's staff password to a known value. Run with:
//   pnpm --filter @hardware/db exec tsx prisma/reset-owner-password.ts
// Optionally set NEW_PW to choose the password (defaults to ChangeMe!123).
// Mirrors packages/auth/src/password.ts hashing (argon2id, 64 MiB, 3 iters) so the
// resulting hash verifies at login. Connects using packages/db/.env DATABASE_URL.
import { PrismaClient } from "@prisma/client";
import { argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const EMAIL = "owner@hardware.local";

async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "encoded",
  });
}

async function main(): Promise<void> {
  const newPw = process.env.NEW_PW ?? "ChangeMe!123";
  const passwordHash = await hashPassword(newPw);
  const user = await prisma.staffUser.update({
    where: { email: EMAIL },
    data: { passwordHash, status: "ACTIVE", emailVerified: new Date() },
    select: { email: true },
  });
  // eslint-disable-next-line no-console
  console.log(`Password reset for ${user.email} -> "${newPw}"`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
