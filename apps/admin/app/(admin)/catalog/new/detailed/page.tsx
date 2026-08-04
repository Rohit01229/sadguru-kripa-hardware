import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listUnits,
  listBrands,
  listCategoryTree,
  ensureDefaultMastersForShop,
  requirePermission,
  Forbidden,
  type CategoryNode,
} from "@hardware/core";
import { ForbiddenState, PageHeader } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../../lib/session";
import { ProductForm } from "../../ProductForm";

// The FULL create form — multiple sale units with conversion factors, per-unit MRP,
// the lot. Kept for shops that genuinely sell one product in several units (a coil of
// wire by the metre AND by the coil). The quick "New Item" form at /catalog/new is the
// default path (19 §2); this is linked from it, not from the nav.
export default async function NewProductDetailedPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "products.create");
  } catch (e) {
    if (e instanceof Forbidden) {
      return (
        <div className="space-y-6">
          <ForbiddenState perm="products.create" />
        </div>
      );
    }
    throw e;
  }

  const t = await getTranslations("catalog");
  const tc = await getTranslations("common");
  const shopId = await requireShopId();

  let [units, brands, tree] = await Promise.all([
    listUnits(shopId),
    listBrands(shopId),
    listCategoryTree(shopId),
  ]);
  // Same on-demand seeding as the quick form — this page must never dead-end either.
  if (units.length === 0 || tree.length === 0) {
    await ensureDefaultMastersForShop(shopId);
    [units, tree] = await Promise.all([listUnits(shopId), listCategoryTree(shopId)]);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("form.newTitle")}
        description={t("form.newDescription")}
        breadcrumbs={[
          { label: tc("nav.catalog"), href: "/catalog" },
          { label: t("form.itemTitle"), href: "/catalog/new" },
          { label: t("form.newTitle") },
        ]}
        linkComponent={Link}
      />
      <ProductForm units={units} categories={flatten(tree)} brands={brands} />
    </div>
  );
}

function flatten(tree: CategoryNode[], depth = 0): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const node of tree) {
    out.push({ id: node.id, name: `${"— ".repeat(depth)}${node.name}` });
    if (node.children.length) out.push(...flatten(node.children, depth + 1));
  }
  return out;
}
