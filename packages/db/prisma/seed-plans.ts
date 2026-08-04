// Default subscription plans (16 §8 P4).
//
// Idempotent upsert by `key`, so re-running never duplicates a tier and never silently
// changes the price of a plan customers are already on — it updates the definition, and
// the operator is expected to know that. Keys are stable; names and prices are not.
//
// Limits are chosen so the free tier is genuinely usable (a one-person shop can run on
// it) rather than a crippled demo. The point of the paid tiers is scale, not unlocking
// basic billing — a shopkeeper who cannot make a bill will simply leave.
//
//   pnpm db:seed:plans
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RUPEES = (n: number) => n * 100; // paise

const PLANS = [
  {
    key: "FREE",
    name: "Free",
    pricePaise: 0,
    maxProducts: 100,
    maxInvoicesPerMonth: 100,
    maxStaff: 1,
    features: { storefront: false, einvoice: false, billTheme: true, multiUser: false },
    sortOrder: 0,
  },
  {
    key: "STARTER",
    name: "Starter",
    pricePaise: RUPEES(299),
    maxProducts: 1000,
    maxInvoicesPerMonth: 1000,
    maxStaff: 3,
    features: { storefront: false, einvoice: false, billTheme: true, multiUser: true },
    sortOrder: 1,
  },
  {
    key: "PRO",
    name: "Pro",
    pricePaise: RUPEES(599),
    // null = unlimited
    maxProducts: null,
    maxInvoicesPerMonth: null,
    maxStaff: 10,
    features: { storefront: true, einvoice: false, billTheme: true, multiUser: true },
    sortOrder: 2,
  },
  {
    key: "ENTERPRISE",
    name: "Enterprise",
    pricePaise: RUPEES(1499),
    maxProducts: null,
    maxInvoicesPerMonth: null,
    maxStaff: null,
    // e-invoicing sits here because it needs a GSP integration we have not built
    // (doc 20) — the flag reserves the tier, it does not promise a working feature yet.
    features: { storefront: true, einvoice: true, billTheme: true, multiUser: true },
    sortOrder: 3,
  },
] as const;

async function main() {
  for (const p of PLANS) {
    await prisma.plan.upsert({
      where: { key: p.key },
      update: {
        name: p.name,
        pricePaise: p.pricePaise,
        maxProducts: p.maxProducts,
        maxInvoicesPerMonth: p.maxInvoicesPerMonth,
        maxStaff: p.maxStaff,
        features: p.features,
        sortOrder: p.sortOrder,
        isActive: true,
      },
      create: { ...p, features: p.features, isActive: true },
    });
  }
  const rows = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
  console.log(
    "Plans seeded:\n" +
      rows
        .map(
          (r) =>
            `  ${r.key.padEnd(11)} ₹${(r.pricePaise / 100).toString().padStart(5)}/mo  ` +
            `items=${r.maxProducts ?? "∞"} bills/mo=${r.maxInvoicesPerMonth ?? "∞"} users=${r.maxStaff ?? "∞"}`,
        )
        .join("\n"),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Plan seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
