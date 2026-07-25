import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listUnits, listBrands, listCategoryTree, type CategoryNode } from "@hardware/core";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { UnitForm, CategoryForm, BrandForm } from "./MasterForms";

// Unit / Category / Brand management (S2). Unit creation needs units.manage;
// category/brand need products.create — the actions enforce it, the UI is cosmetic.
export default async function MastersPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  const t = await getTranslations("catalog");
  const tc = await getTranslations("common");
  const [units, brands, tree] = await Promise.all([listUnits(), listBrands(), listCategoryTree()]);
  const flat = flatten(tree);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("masters.title")}
        description={t("masters.description")}
        breadcrumbs={[{ label: tc("nav.catalog"), href: "/catalog" }, { label: t("masters.breadcrumb") }]}
        linkComponent={Link}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("masters.unitsSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UnitForm />
          {units.length === 0 ? (
            <EmptyState title={t("masters.unitsEmptyTitle")} description={t("masters.unitsEmptyDescription")} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("masters.colCode")}</TableHead>
                    <TableHead>{t("masters.colName")}</TableHead>
                    <TableHead>{t("masters.colKind")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono font-medium">{u.code}</TableCell>
                      <TableCell>{u.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{u.kind}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("masters.categoriesSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CategoryForm options={flat} />
          {flat.length === 0 ? (
            <EmptyState title={t("masters.categoriesEmptyTitle")} description={t("masters.categoriesEmptyDescription")} />
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {flat.map((c) => (
                <li key={c.id} className="px-3 py-2">
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("masters.brandsSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <BrandForm />
          {brands.length === 0 ? (
            <EmptyState title={t("masters.brandsEmptyTitle")} description={t("masters.brandsEmptyDescription")} />
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {brands.map((b) => (
                <li key={b.id} className="px-3 py-2">
                  {b.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
