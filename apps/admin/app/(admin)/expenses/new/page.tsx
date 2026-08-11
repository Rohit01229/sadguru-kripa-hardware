import { redirect } from "next/navigation";
import { listExpenseCategories, requirePermission, Forbidden } from "@hardware/core";
import { PageHeader, ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../lib/session";
import { ExpenseForm } from "../ExpenseForm";

// `listExpenseCategories` seeds the starter set on first use, so a brand-new shop lands
// on a usable form rather than an empty dropdown (19 §4 — no masters wall).
export default async function NewExpensePage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "expenses.write");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="expenses.write" />;
    throw e;
  }

  const shopId = await requireShopId();
  const categories = await listExpenseCategories(shopId);

  return (
    <div className="space-y-6">
      <PageHeader title="Add expense" description="Rent, wages, freight, electricity — anything that is not stock." />
      <ExpenseForm categories={categories} />
    </div>
  );
}
