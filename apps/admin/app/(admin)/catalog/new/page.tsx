import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  listUnits,
  listBrands,
  listCategoryTree,
  requirePermission,
  Forbidden,
  type CategoryNode,
} from "@hardware/core";
import { Button, EmptyState, ForbiddenState, PageHeader } from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { ProductForm } from "../ProductForm";

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
  const [units, brands, tree] = await Promise.all([listUnits(), listBrands(), listCategoryTree()]);
  const categories = flatten(tree);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("form.newTitle")}
        description={t("form.newDescription")}
        breadcrumbs={[{ label: tc("nav.catalog"), href: "/catalog" }, { label: t("form.newTitle") }]}
        linkComponent={Link}
      />
      {units.length === 0 || categories.length === 0 ? (
        <EmptyState
          title={t("form.mastersFirstTitle")}
          description={t("form.mastersFirstDescription")}
          action={
            <Button asChild>
              <Link href="/catalog/masters">{t("form.addUnitsCategories")}</Link>
            </Button>
          }
        />
      ) : (
        <ProductForm units={units} categories={categories} brands={brands} />
      )}
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
