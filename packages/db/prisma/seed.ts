// Prisma seed — idempotent. S0 skeleton (StoreConfig) + S1 RBAC bootstrap.
//
// S1 (14-impl-plan Chunk 5 §6): upsert all 33 Permission rows sourced from the
// @hardware/core PERMISSIONS constant (so code and DB never drift — 10 §6),
// upsert Role{OWNER}, map OWNER → every permission, and create the first
// StaffUser (argon2id password from SEED_OWNER_PASSWORD, default 'ChangeMe!123')
// + UserRole. Re-runnable: every write is an upsert / existence-checked.
//
// Note: PERMISSIONS is imported from the core SOURCE file (not the @hardware/core
// package) and argon2id is reproduced inline from packages/auth/src/password.ts
// to keep the seed dependency-acyclic — core/auth depend on @hardware/db, so a
// package edge here would create a workspace cycle. The hash params MUST match
// password.ts so the seeded hash verifies at login.

import { PrismaClient } from "@prisma/client";
import { argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";
import { PERMISSIONS } from "../../core/src/shared/rbac";

const prisma = new PrismaClient();

const OWNER_EMAIL = "owner@hardware.local";

// Mirror of packages/auth/src/password.ts hashPassword (argon2id, 64 MiB, 3 iters).
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
  // 1. StoreConfig "default" (S0 skeleton) — unchanged on re-run.
  const store = await prisma.storeConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      name: "My Hardware Store",
      homeState: "19", // 19 = West Bengal (placeholder home state; 03 §8)
    },
  });

  // 2. Permissions — upsert each of the 33 keys from the core constant.
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const allPermissions = await prisma.permission.findMany({ select: { id: true, key: true } });

  // 3. Role{OWNER} (holds ALL permissions — the model expresses "all", never "skip the check", 10 §1).
  const owner = await prisma.role.upsert({
    where: { key: "OWNER" },
    update: { label: "Owner / Admin" },
    create: { key: "OWNER", label: "Owner / Admin" },
  });

  // 4. Map OWNER → every permission (idempotent on the composite PK).
  for (const p of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: owner.id, permissionId: p.id } },
      update: {},
      create: { roleId: owner.id, permissionId: p.id },
    });
  }

  // 5. First StaffUser (the single owner login) + UserRole(OWNER).
  const passwordPlain = process.env.SEED_OWNER_PASSWORD ?? "ChangeMe!123";
  const existing = await prisma.staffUser.findUnique({ where: { email: OWNER_EMAIL } });
  const ownerUser =
    existing ??
    (await prisma.staffUser.create({
      data: {
        email: OWNER_EMAIL,
        name: "Owner",
        status: "ACTIVE",
        emailVerified: new Date(),
        passwordHash: await hashPassword(passwordPlain),
      },
    }));

  await prisma.userRole.upsert({
    where: { staffUserId_roleId: { staffUserId: ownerUser.id, roleId: owner.id } },
    update: {},
    create: { staffUserId: ownerUser.id, roleId: owner.id },
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seeded: StoreConfig=${store.id}; ${allPermissions.length} permissions; ` +
      `Role OWNER -> all; StaffUser ${OWNER_EMAIL} (${existing ? "existing" : "created"}).`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
