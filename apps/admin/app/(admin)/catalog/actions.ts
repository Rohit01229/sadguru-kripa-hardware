"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
  addSaleUnit,
  editSaleUnit,
  setPriceSlabs,
  createCategory,
  createBrand,
  createUnit,
  listCategoryTree,
  listBrands,
  type CategoryNode,
  createProductSchema,
  saleUnitInputSchema,
  setPriceSlabsSchema,
  upsertCategorySchema,
  upsertBrandSchema,
  upsertUnitSchema,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Catalog server actions (transport layer). Each: resolve the staff session,
// Zod-validate via the ONE core schema, call the core service (which
// requirePermission + audit in one tx), then revalidate. Returns a flat
// { ok | error } so client forms can render inline errors. UI hiding is cosmetic;
// the core guard is the gate (10 §5).

export interface ActionState {
  ok?: boolean;
  error?: string;
  id?: string;
}

/** Turn a thrown core error into a form-friendly message + log. */
function toState(e: unknown): ActionState {
  if (e instanceof Forbidden) return { error: "You do not have permission for this action." };
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return { error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid input." };
  }
  if (e instanceof DomainError) {
    switch (e.code) {
      case "DUP_SKU":
        return { error: "A product with this SKU already exists." };
      case "DUP_SALE_UNIT":
        return { error: "That sale unit is already attached to the product." };
      case "DUP_UNIT_CODE":
        return { error: "A unit with this code already exists." };
      case "DUP_NAME":
        return { error: "That name is already taken." };
      case "NOT_FOUND":
        return { error: "Record not found." };
      default:
        return { error: e.message };
    }
  }
  return { error: "Something went wrong. Please try again." };
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

const boolFrom = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

/** Sentinel the product form submits when the operator picks "Other…" and types a new name. */
const OTHER = "__other__";

function flattenCats(nodes: CategoryNode[], out: { id: string; name: string }[] = []): { id: string; name: string }[] {
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name });
    if (n.children.length > 0) flattenCats(n.children, out);
  }
  return out;
}

/**
 * Turn the category select into an id. When it's the "Other…" sentinel, match the
 * typed name against existing categories case-insensitively (so we don't spawn a
 * duplicate) and otherwise create it — then return the id the product create needs.
 */
async function resolveCategoryId(
  selected: string,
  otherName: string,
  c: Awaited<ReturnType<typeof ctx>>,
): Promise<string> {
  if (selected !== OTHER) return selected;
  const name = otherName.trim();
  if (!name) throw new DomainError("Enter a category name.", "VALIDATION");
  const existing = flattenCats(await listCategoryTree()).find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;
  return (await createCategory({ name }, c)).id;
}

/** Same as resolveCategoryId, but brand is optional (empty selection → null). */
async function resolveBrandId(
  selected: string,
  otherName: string,
  c: Awaited<ReturnType<typeof ctx>>,
): Promise<string | null> {
  if (selected !== OTHER) return selected || null;
  const name = otherName.trim();
  if (!name) throw new DomainError("Enter a brand name.", "VALIDATION");
  const existing = (await listBrands()).find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  return (await createBrand({ name }, c)).id;
}

/** Parse the dynamic sale-unit rows out of a product form. */
function parseSaleUnits(form: FormData): { unitId: string; factorToBase: string; salePrice: number; mrp: number | null; isDefault: boolean }[] {
  const unitIds = form.getAll("saleUnitId").map(String);
  const factors = form.getAll("factorToBase").map(String);
  const prices = form.getAll("salePrice").map(String);
  const mrps = form.getAll("mrp").map(String);
  const defaultIdx = form.get("defaultSaleUnitIndex");
  const rows: { unitId: string; factorToBase: string; salePrice: number; mrp: number | null; isDefault: boolean }[] = [];
  for (let i = 0; i < unitIds.length; i++) {
    if (!unitIds[i]) continue;
    const mrpVal = mrps[i] && mrps[i] !== "" ? Math.round(Number(mrps[i]) * 100) : null;
    rows.push({
      unitId: unitIds[i]!,
      factorToBase: factors[i] ?? "1",
      // form prices are entered in rupees; convert to paise on the wire
      salePrice: Math.round(Number(prices[i] ?? "0") * 100),
      mrp: mrpVal,
      isDefault: String(defaultIdx) === String(i),
    });
  }
  return rows;
}

export async function createProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const categoryId = await resolveCategoryId(
      String(form.get("categoryId") ?? ""),
      String(form.get("categoryNameOther") ?? ""),
      c,
    );
    const brandId = await resolveBrandId(
      String(form.get("brandId") ?? ""),
      String(form.get("brandNameOther") ?? ""),
      c,
    );
    const input = createProductSchema.parse({
      sku: form.get("sku"),
      name: form.get("name"),
      brandId,
      categoryId,
      hsnCode: form.get("hsnCode") || null,
      baseUnitId: form.get("baseUnitId"),
      costPerBaseUnit: form.get("costPerBaseUnit") ? Math.round(Number(form.get("costPerBaseUnit")) * 100) : 0,
      gstRatePct: String(form.get("gstRatePct") ?? "0"),
      priceInclusive: boolFrom(form.get("priceInclusive")),
      reorderLevel: form.get("reorderLevel") || null,
      trackExpiry: boolFrom(form.get("trackExpiry")),
      allowNegative: boolFrom(form.get("allowNegative")),
      availableOnline: form.get("availableOnline") === null ? true : boolFrom(form.get("availableOnline")),
      imageKeys: form.getAll("imageKeys").map(String).filter((s) => s.length > 0),
      saleUnits: parseSaleUnits(form),
    });
    const product = await createProduct(input, c);
    revalidatePath("/catalog");
    revalidatePath("/dashboard");
    return { ok: true, id: product.id };
  } catch (e) {
    return toState(e);
  }
}

export async function updateProductAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    await updateProduct(
      id,
      {
        name: form.get("name") ? String(form.get("name")) : undefined,
        brandId: form.has("brandId") ? (form.get("brandId") || null) as string | null : undefined,
        categoryId: form.get("categoryId") ? String(form.get("categoryId")) : undefined,
        hsnCode: form.has("hsnCode") ? ((form.get("hsnCode") || null) as string | null) : undefined,
        costPerBaseUnit: form.get("costPerBaseUnit") ? Math.round(Number(form.get("costPerBaseUnit")) * 100) : undefined,
        gstRatePct: form.get("gstRatePct") ? String(form.get("gstRatePct")) : undefined,
        priceInclusive: form.has("priceInclusive") ? boolFrom(form.get("priceInclusive")) : undefined,
        reorderLevel: form.has("reorderLevel") ? ((form.get("reorderLevel") || null) as string | null) : undefined,
        availableOnline: form.has("availableOnline") ? boolFrom(form.get("availableOnline")) : undefined,
      },
      c,
    );
    revalidatePath("/catalog");
    revalidatePath(`/catalog/${id}`);
    return { ok: true, id };
  } catch (e) {
    return toState(e);
  }
}

/**
 * Replace a product's image list (edit page). Images are uploaded browser-side to
 * Cloudinary; this persists the resulting URLs. Guarded products.update in core.
 */
export async function setProductImagesAction(id: string, imageKeys: string[]): Promise<ActionState> {
  try {
    const c = await ctx();
    await updateProduct(id, { imageKeys }, c);
    revalidatePath("/catalog");
    revalidatePath(`/catalog/${id}`);
    return { ok: true, id };
  } catch (e) {
    return toState(e);
  }
}

export async function archiveProductAction(id: string): Promise<ActionState> {
  try {
    const c = await ctx();
    await archiveProduct(id, c);
    revalidatePath("/catalog");
    revalidatePath("/dashboard");
    return { ok: true, id };
  } catch (e) {
    return toState(e);
  }
}

export async function unarchiveProductAction(id: string): Promise<ActionState> {
  try {
    const c = await ctx();
    await unarchiveProduct(id, c);
    revalidatePath("/catalog");
    return { ok: true, id };
  } catch (e) {
    return toState(e);
  }
}

export async function addSaleUnitAction(productId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = saleUnitInputSchema.parse({
      unitId: form.get("unitId"),
      factorToBase: String(form.get("factorToBase") ?? "1"),
      salePrice: Math.round(Number(form.get("salePrice") ?? "0") * 100),
      mrp: form.get("mrp") ? Math.round(Number(form.get("mrp")) * 100) : null,
      isDefault: boolFrom(form.get("isDefault")),
    });
    await addSaleUnit(productId, input, c);
    revalidatePath(`/catalog/${productId}`);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function editSaleUnitAction(
  productId: string,
  saleUnitId: string,
  patch: { factorToBase?: string; salePrice?: number; mrp?: number | null; isDefault?: boolean },
): Promise<ActionState> {
  try {
    const c = await ctx();
    await editSaleUnit(productId, saleUnitId, patch, c);
    revalidatePath(`/catalog/${productId}`);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function setPriceSlabsAction(productId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const saleUnitId = String(form.get("saleUnitId"));
    const minQtys = form.getAll("slabMinQty").map(String);
    const prices = form.getAll("slabPrice").map(String);
    const slabs = minQtys
      .map((minQty, i) => ({ minQty, pricePerSaleUnit: Math.round(Number(prices[i] ?? "0") * 100) }))
      .filter((s) => s.minQty && s.minQty !== "");
    const input = setPriceSlabsSchema.parse({ saleUnitId, slabs });
    await setPriceSlabs(productId, input, c);
    revalidatePath(`/catalog/${productId}`);
    return { ok: true };
  } catch (e) {
    return toState(e);
  }
}

export async function createCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = upsertCategorySchema.parse({ name: form.get("name"), parentId: form.get("parentId") || null });
    const cat = await createCategory(input, c);
    revalidatePath("/catalog/masters");
    return { ok: true, id: cat.id };
  } catch (e) {
    return toState(e);
  }
}

export async function createBrandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = upsertBrandSchema.parse({ name: form.get("name") });
    const b = await createBrand(input, c);
    revalidatePath("/catalog/masters");
    return { ok: true, id: b.id };
  } catch (e) {
    return toState(e);
  }
}

export async function createUnitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = upsertUnitSchema.parse({
      code: form.get("code"),
      name: form.get("name"),
      kind: form.get("kind"),
    });
    const u = await createUnit(input, c);
    revalidatePath("/catalog/masters");
    return { ok: true, id: u.id };
  } catch (e) {
    return toState(e);
  }
}
