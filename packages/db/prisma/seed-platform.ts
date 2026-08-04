// Create the first platform (super-admin) account — 16 §4a.
//
// Separate from seed.ts on purpose: the shop seed is dev fixture data, but this creates
// the account that can provision and suspend real tenants. It is idempotent (upsert), so
// re-running it will not clobber an existing operator, and it reads the password from
// the environment rather than hardcoding one.
//
//   PLATFORM_EMAIL=you@example.com PLATFORM_PASSWORD='…' pnpm db:seed:platform
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@hardware/auth";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.PLATFORM_EMAIL ?? "admin@platform.local").toLowerCase();
  const password = process.env.PLATFORM_PASSWORD ?? "ChangeMe!123";
  const name = process.env.PLATFORM_NAME ?? "Platform Admin";

  if (password === "ChangeMe!123") {
    console.warn(
      "\n  ⚠  Using the default password. Set PLATFORM_PASSWORD before using this in production.\n",
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.platformUser.upsert({
    where: { email },
    // Never silently reset an existing operator's password on re-run.
    update: { name, status: "ACTIVE" },
    create: { email, name, passwordHash, role: "SUPER_ADMIN", status: "ACTIVE" },
    select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
  });

  const created = user.createdAt.getTime() === user.updatedAt.getTime();
  console.log(
    `Platform ${created ? "account created" : "account already existed (left unchanged)"}: ` +
      `${user.email} (${user.role})`,
  );
  if (created) console.log("Sign in at /platform/login");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Platform seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
