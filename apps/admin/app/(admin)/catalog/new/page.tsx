import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listUnits,
  listBrands,
  listCategoryTree,
  getLastUsedGstRate,
  ensureDefaultMastersForShop,
  requirePermission,
  Forbidden,
  type CategoryNode,
} from "@hardware/core";
import { ForbiddenState, PageHeader } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { ItemForm } from "../ItemForm";

export default async function NewProductPage() {
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

  let [units, brands, tree, lastGst] = await Promise.all([
    listUnits(shopId),
    listBrands(shopId),
    listCategoryTree(shopId),
    getLastUsedGstRate(shopId),
  ]);

  // No masters wall (19 §2). A brand-new shop has no units yet, but the Unit select
  // needs options — so seed the starter set here (idempotent; only fires when the
  // shop is genuinely empty) instead of sending the shopkeeper to a set-up screen
  // before their first item. `createProduct` performs the same back-fill server-side,
  // so this is purely so the dropdown has something to show.
  if (units.length === 0) {
    await ensureDefaultMastersForShop(shopId);
    [units, tree] = await Promise.all([listUnits(shopId), listCategoryTree(shopId)]);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t("form.itemTitle")}
        description={t("form.itemDescription")}
        breadcrumbs={[{ label: tc("nav.catalog"), href: "/catalog" }, { label: t("form.itemTitle") }]}
        linkComponent={Link}
      />
      <ItemForm
        units={units}
        categories={flatten(tree)}
        brands={brands}
        defaultGstRate={lastGst ?? "18"}
      />
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
