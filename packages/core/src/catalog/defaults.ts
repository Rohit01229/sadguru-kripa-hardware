// Starter masters for a shop (myBillBook-simple onboarding). A brand-new shop has
// no Units and no Categories, but a Product REQUIRES both (baseUnitId + categoryId
// are NOT NULL — 13 §Catalog). Rather than force the shopkeeper through two master
// screens before their first item, `createProduct` calls ensureDefaultMasters inside
// its transaction and back-fills whichever id the caller omitted, so "name + price"
// is genuinely enough to add stock.
//
// Seeding is ALL-OR-NOTHING per master: the starter units land only when the shop has
// zero units, and "General" only when it has zero categories. That keeps the helper
// idempotent AND non-intrusive — once a shopkeeper has curated their own masters (or
// deleted the ones they don't want) we never re-add anything behind their back.
//
// Every create stamps `shopId` (17 §2) and runs on the caller-supplied `Tx`, so this
// composes inside the ONE transaction a single user action opens (03 §2) — it never
// opens its own. Use `ensureDefaultMastersForShop` when there is no ambient tx
// (shop provisioning / seeding).
import { runTx, type Tx } from "../shared/db";

/** The unit a product falls back to when the caller names none. */
export const DEFAULT_UNIT_CODE = "PCS";
/** The category a product falls back to when the caller names none. */
export const DEFAULT_CATEGORY_NAME = "General";

/**
 * Hardware-store starter units. PIECE units reject fractional quantities (uom.toBaseQty),
 * MEASURED units allow them — so "3.5 kg" is fine but "3.5 pieces" is not. Codes are the
 * per-shop unique key (`@@unique([shopId, code])`).
 */
export const DEFAULT_UNITS: ReadonlyArray<{ code: string; name: string; kind: "MEASURED" | "PIECE" }> = [
  { code: "PCS", name: "Piece", kind: "PIECE" },
  { code: "BOX", name: "Box", kind: "PIECE" },
  { code: "BAG", name: "Bag", kind: "PIECE" },
  { code: "DOZ", name: "Dozen", kind: "PIECE" },
  { code: "ROLL", name: "Roll", kind: "PIECE" },
  { code: "COIL", name: "Coil", kind: "PIECE" },
  { code: "BDL", name: "Bundle", kind: "PIECE" },
  { code: "KG", name: "Kilogram", kind: "MEASURED" },
  { code: "G", name: "Gram", kind: "MEASURED" },
  { code: "L", name: "Litre", kind: "MEASURED" },
  { code: "M", name: "Metre", kind: "MEASURED" },
  { code: "FT", name: "Feet", kind: "MEASURED" },
  { code: "SQFT", name: "Square Feet", kind: "MEASURED" },
];

export interface DefaultMasters {
  /** The PCS unit (or, on an already-populated shop, its first unit by code). */
  defaultUnitId: string;
  /** The "General" category (or, on an already-populated shop, its first category by name). */
  defaultCategoryId: string;
}

/**
 * Ensure the shop has at least one unit and one category, and return the ids a
 * product should default to. Idempotent and safe to call on every create: it seeds
 * only when the respective master is EMPTY, then resolves the preferred row.
 *
 * Runs entirely on the caller's `tx` (never opens its own), so it rolls back with
 * the product create it is part of.
 *
 * Concurrency: two first-ever creates racing on a brand-new shop can both see an
 * empty table. Units are protected by `@@unique([shopId, code])` + `skipDuplicates`,
 * so the loser inserts nothing. Category has no such unique, so a dead-heat can leave
 * two "General" rows — harmless (both are real categories and the resolve below picks
 * one deterministically), and the window is a single brand-new shop's first two
 * concurrent items.
 */
export async function ensureDefaultMasters(tx: Tx, shopId: string): Promise<DefaultMasters> {
  const unitCount = await tx.unit.count({ where: { shopId } });
  if (unitCount === 0) {
    await tx.unit.createMany({
      data: DEFAULT_UNITS.map((u) => ({ shopId, code: u.code, name: u.name, kind: u.kind })),
      skipDuplicates: true,
    });
  }

  const categoryCount = await tx.category.count({ where: { shopId } });
  if (categoryCount === 0) {
    await tx.category.create({ data: { shopId, name: DEFAULT_CATEGORY_NAME } });
  }

  // Resolve the canonical fallback row, CREATING it if this shop happens not to have
  // one (it may already have had its own masters, or have deleted ours).
  //
  // Deliberately NOT "else use the shop's first row": an item that named no category
  // would then be filed under whatever sorts first — a door hinge landing in
  // "Cement & Concrete" — which is silently wrong and leaves the shopkeeper cleaning up.
  // An explicit "General" bucket is honest about what we know.
  let unit = await tx.unit.findFirst({
    where: { shopId, code: { equals: DEFAULT_UNIT_CODE, mode: "insensitive" } },
    select: { id: true },
  });
  unit ??= await tx.unit.create({
    data: { shopId, code: DEFAULT_UNIT_CODE, name: "Piece", kind: "PIECE" },
    select: { id: true },
  });

  let category = await tx.category.findFirst({
    where: { shopId, name: { equals: DEFAULT_CATEGORY_NAME, mode: "insensitive" } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  category ??= await tx.category.create({
    data: { shopId, name: DEFAULT_CATEGORY_NAME },
    select: { id: true },
  });

  return { defaultUnitId: unit.id, defaultCategoryId: category.id };
}

/**
 * `ensureDefaultMasters` for callers with no ambient transaction — shop provisioning
 * (super-admin creates a shop) and seeding. Opens ONE transaction via runTx.
 */
export async function ensureDefaultMastersForShop(shopId: string): Promise<DefaultMasters> {
  return runTx((tx) => ensureDefaultMasters(tx, shopId));
}
