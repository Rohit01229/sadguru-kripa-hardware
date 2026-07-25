// Demo catalog seed — OPT-IN, idempotent. Run explicitly with
//   pnpm --filter @hardware/db db:seed:demo
// to give a fresh install a realistic starter catalog (units, categories, brands,
// ~10 hardware products with sale units, quantity-break price slabs, and opening
// stock) instead of ad-hoc test rows. Safe to re-run: every write is an upsert keyed
// on a stable id / unique column, and price slabs are replaced per sale unit.
//
// This does NOT touch RBAC or StoreConfig (see seed.ts). Images are left empty —
// upload product photos from the admin catalog (Cloudinary) after seeding.
//
// Prices are RUPEES (the DB stores Decimal rupees; the app converts paise↔rupees at
// the edge). gstRate is the whole percentage (e.g. 18 = 18%).

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type Kind = "MEASURED" | "PIECE";

// ── Reference data ───────────────────────────────────────────────────────────
const UNITS: { code: string; name: string; kind: Kind }[] = [
  { code: "pc", name: "Piece", kind: "PIECE" },
  { code: "bag", name: "Bag", kind: "PIECE" },
  { code: "kg", name: "Kilogram", kind: "MEASURED" },
  { code: "m", name: "Metre", kind: "MEASURED" },
  { code: "L", name: "Litre", kind: "MEASURED" },
  { code: "coil", name: "Coil", kind: "PIECE" },
  { code: "bucket", name: "Bucket", kind: "PIECE" },
  { code: "box", name: "Box", kind: "PIECE" },
];

const CATEGORIES: { id: string; name: string }[] = [
  { id: "demo-cement", name: "Cement & Concrete" },
  { id: "demo-steel", name: "Steel & TMT" },
  { id: "demo-paint", name: "Paints & Finishes" },
  { id: "demo-plumbing", name: "Plumbing" },
  { id: "demo-electrical", name: "Electrical" },
  { id: "demo-fasteners", name: "Hardware & Fasteners" },
  { id: "demo-tools", name: "Tools & Power Tools" },
];

const BRANDS = ["UltraTech", "Tata Tiscon", "Asian Paints", "Finolex", "Havells", "Bosch", "Pidilite", "Anchor"];

interface SaleUnitSeed {
  unitCode: string;
  factorToBase: string; // baseQty = saleQty × factorToBase
  salePrice: number; // rupees
  mrp?: number; // rupees
  isDefault?: boolean;
  slabs?: { minQty: string; pricePerSaleUnit: number }[]; // quantity-break rupees
}

interface ProductSeed {
  sku: string;
  name: string;
  categoryId: string;
  brand?: string;
  hsnCode?: string;
  gstRate: number; // percent
  costPerBaseUnit: number; // rupees
  baseUnitCode: string;
  reorderLevel?: string; // base units
  trackExpiry?: boolean;
  openingStock: string; // base units on hand
  saleUnits: SaleUnitSeed[];
}

const PRODUCTS: ProductSeed[] = [
  {
    sku: "CEM-UT-PPC-50",
    name: "UltraTech PPC Cement 50 kg",
    categoryId: "demo-cement",
    brand: "UltraTech",
    hsnCode: "2523",
    gstRate: 28,
    costPerBaseUnit: 380,
    baseUnitCode: "bag",
    reorderLevel: "20",
    openingStock: "200",
    saleUnits: [
      {
        unitCode: "bag",
        factorToBase: "1",
        salePrice: 420,
        mrp: 450,
        isDefault: true,
        slabs: [
          { minQty: "50", pricePerSaleUnit: 410 },
          { minQty: "100", pricePerSaleUnit: 400 },
        ],
      },
    ],
  },
  {
    sku: "PUT-UT-WP-20",
    name: "UltraTech Weather Pro Wall Putty 20 kg",
    categoryId: "demo-cement",
    brand: "UltraTech",
    hsnCode: "3214",
    gstRate: 18,
    costPerBaseUnit: 560,
    baseUnitCode: "bag",
    reorderLevel: "10",
    openingStock: "80",
    saleUnits: [{ unitCode: "bag", factorToBase: "1", salePrice: 640, mrp: 700, isDefault: true }],
  },
  {
    sku: "TMT-TT-12MM",
    name: "Tata Tiscon TMT Bar 12 mm (Fe 500D)",
    categoryId: "demo-steel",
    brand: "Tata Tiscon",
    hsnCode: "7214",
    gstRate: 18,
    costPerBaseUnit: 58,
    baseUnitCode: "kg",
    reorderLevel: "500",
    openingStock: "5000",
    saleUnits: [
      { unitCode: "kg", factorToBase: "1", salePrice: 65, isDefault: true, slabs: [{ minQty: "1000", pricePerSaleUnit: 63 }] },
    ],
  },
  {
    sku: "PNT-AP-APCO-1L",
    name: "Asian Paints Apcolite Premium Enamel 1 L",
    categoryId: "demo-paint",
    brand: "Asian Paints",
    hsnCode: "3208",
    gstRate: 18,
    costPerBaseUnit: 280,
    baseUnitCode: "L",
    reorderLevel: "20",
    openingStock: "150",
    saleUnits: [
      { unitCode: "L", factorToBase: "1", salePrice: 320, mrp: 360, isDefault: true },
      { unitCode: "bucket", factorToBase: "4", salePrice: 1200, mrp: 1360 },
    ],
  },
  {
    sku: "PIP-FX-PVC-25",
    name: "Finolex PVC Pipe 25 mm (1 inch)",
    categoryId: "demo-plumbing",
    brand: "Finolex",
    hsnCode: "3917",
    gstRate: 18,
    costPerBaseUnit: 70,
    baseUnitCode: "m",
    reorderLevel: "100",
    openingStock: "800",
    saleUnits: [{ unitCode: "m", factorToBase: "1", salePrice: 85, isDefault: true }],
  },
  {
    sku: "WIR-HV-25SQ",
    name: "Havells Life Line Wire 2.5 sq mm",
    categoryId: "demo-electrical",
    brand: "Havells",
    hsnCode: "8544",
    gstRate: 18,
    costPerBaseUnit: 15,
    baseUnitCode: "m",
    reorderLevel: "450",
    openingStock: "2700",
    saleUnits: [
      { unitCode: "m", factorToBase: "1", salePrice: 18 },
      { unitCode: "coil", factorToBase: "90", salePrice: 1550, mrp: 1700, isDefault: true },
    ],
  },
  {
    sku: "SWT-AN-ROMA-6A",
    name: "Anchor Roma One-Way Switch 6 A",
    categoryId: "demo-electrical",
    brand: "Anchor",
    hsnCode: "8536",
    gstRate: 18,
    costPerBaseUnit: 55,
    baseUnitCode: "pc",
    reorderLevel: "40",
    openingStock: "500",
    saleUnits: [
      { unitCode: "pc", factorToBase: "1", salePrice: 75, mrp: 90, isDefault: true },
      { unitCode: "box", factorToBase: "20", salePrice: 1400 },
    ],
  },
  {
    sku: "ADH-PD-FEV-1KG",
    name: "Pidilite Fevicol SH Adhesive 1 kg",
    categoryId: "demo-fasteners",
    brand: "Pidilite",
    hsnCode: "3506",
    gstRate: 18,
    costPerBaseUnit: 150,
    baseUnitCode: "kg",
    reorderLevel: "15",
    openingStock: "100",
    saleUnits: [{ unitCode: "kg", factorToBase: "1", salePrice: 180, mrp: 210, isDefault: true }],
  },
  {
    sku: "SCR-GI-WD-2IN",
    name: "GI Wood Screw 2 inch",
    categoryId: "demo-fasteners",
    hsnCode: "7318",
    gstRate: 18,
    costPerBaseUnit: 1.2,
    baseUnitCode: "pc",
    reorderLevel: "1000",
    openingStock: "10000",
    saleUnits: [
      { unitCode: "pc", factorToBase: "1", salePrice: 2 },
      { unitCode: "box", factorToBase: "100", salePrice: 180, isDefault: true, slabs: [{ minQty: "10", pricePerSaleUnit: 170 }] },
    ],
  },
  {
    sku: "TOL-BSH-DRILL-SET",
    name: "Bosch Masonry Drill Bit Set (5 pc)",
    categoryId: "demo-tools",
    brand: "Bosch",
    hsnCode: "8207",
    gstRate: 18,
    costPerBaseUnit: 700,
    baseUnitCode: "box",
    reorderLevel: "10",
    openingStock: "40",
    saleUnits: [{ unitCode: "box", factorToBase: "1", salePrice: 850, mrp: 999, isDefault: true }],
  },
];

async function main(): Promise<void> {
  // 1. Units (upsert by unique code).
  const unitByCode = new Map<string, string>();
  for (const u of UNITS) {
    const row = await prisma.unit.upsert({
      where: { code: u.code },
      update: { name: u.name, kind: u.kind },
      create: { code: u.code, name: u.name, kind: u.kind },
    });
    unitByCode.set(u.code, row.id);
  }

  // 2. Categories (stable ids so re-runs don't duplicate; name isn't unique).
  for (const c of CATEGORIES) {
    await prisma.category.upsert({ where: { id: c.id }, update: { name: c.name }, create: c });
  }

  // 3. Brands (upsert by unique name).
  const brandByName = new Map<string, string>();
  for (const name of BRANDS) {
    const row = await prisma.brand.upsert({ where: { name }, update: {}, create: { name } });
    brandByName.set(name, row.id);
  }

  // 4. Products + sale units + stock + slabs.
  for (const p of PRODUCTS) {
    const baseUnitId = unitByCode.get(p.baseUnitCode);
    if (!baseUnitId) throw new Error(`Unknown base unit ${p.baseUnitCode} for ${p.sku}`);

    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name: p.name,
        categoryId: p.categoryId,
        brandId: p.brand ? brandByName.get(p.brand) ?? null : null,
        hsnCode: p.hsnCode ?? null,
        baseUnitId,
        costPerBaseUnit: new Prisma.Decimal(p.costPerBaseUnit),
        gstRate: new Prisma.Decimal(p.gstRate),
        reorderLevel: p.reorderLevel ? new Prisma.Decimal(p.reorderLevel) : null,
        trackExpiry: p.trackExpiry ?? false,
        availableOnline: true,
        isActive: true,
      },
      create: {
        sku: p.sku,
        name: p.name,
        categoryId: p.categoryId,
        brandId: p.brand ? brandByName.get(p.brand) ?? null : null,
        hsnCode: p.hsnCode ?? null,
        baseUnitId,
        costPerBaseUnit: new Prisma.Decimal(p.costPerBaseUnit),
        gstRate: new Prisma.Decimal(p.gstRate),
        reorderLevel: p.reorderLevel ? new Prisma.Decimal(p.reorderLevel) : null,
        trackExpiry: p.trackExpiry ?? false,
        availableOnline: true,
        isActive: true,
      },
    });

    // Sale units (upsert on the (productId, unitId) composite).
    for (const su of p.saleUnits) {
      const unitId = unitByCode.get(su.unitCode);
      if (!unitId) throw new Error(`Unknown sale unit ${su.unitCode} for ${p.sku}`);
      const suRow = await prisma.productSaleUnit.upsert({
        where: { productId_unitId: { productId: product.id, unitId } },
        update: {
          factorToBase: new Prisma.Decimal(su.factorToBase),
          salePrice: new Prisma.Decimal(su.salePrice),
          mrp: su.mrp === undefined ? null : new Prisma.Decimal(su.mrp),
          isDefault: su.isDefault ?? false,
        },
        create: {
          productId: product.id,
          unitId,
          factorToBase: new Prisma.Decimal(su.factorToBase),
          salePrice: new Prisma.Decimal(su.salePrice),
          mrp: su.mrp === undefined ? null : new Prisma.Decimal(su.mrp),
          isDefault: su.isDefault ?? false,
        },
      });

      // Quantity-break slabs — replace the set for this sale unit so re-runs stay clean.
      await prisma.priceSlab.deleteMany({ where: { saleUnitId: suRow.id } });
      if (su.slabs?.length) {
        await prisma.priceSlab.createMany({
          data: su.slabs.map((s) => ({
            saleUnitId: suRow.id,
            minQty: new Prisma.Decimal(s.minQty),
            pricePerSaleUnit: new Prisma.Decimal(s.pricePerSaleUnit),
          })),
        });
      }
    }

    // Opening stock aggregate (one row per product).
    await prisma.productStock.upsert({
      where: { productId: product.id },
      update: { onHand: new Prisma.Decimal(p.openingStock) },
      create: { productId: product.id, onHand: new Prisma.Decimal(p.openingStock), reserved: new Prisma.Decimal(0) },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Demo catalog seeded: ${UNITS.length} units, ${CATEGORIES.length} categories, ` +
      `${BRANDS.length} brands, ${PRODUCTS.length} products (with sale units, slabs, opening stock).`,
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
