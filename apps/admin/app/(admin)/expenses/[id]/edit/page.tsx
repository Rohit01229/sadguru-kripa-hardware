import { redirect, notFound } from "next/navigation";
import { getExpense, listExpenseCategories, requirePermission, Forbidden } from "@hardware/core";
import { PageHeader, ForbiddenState } from "@hardware/ui";
import { getStaffSession, requireShopId } from "../../../../../lib/session";
import { ExpenseForm } from "../../ExpenseForm";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getStaffSession();
  if (!session) redirect("/login");
  try {
    requirePermission(session, "expenses.write");
  } catch (e) {
    if (e instanceof Forbidden) return <ForbiddenState perm="expenses.write" />;
    throw e;
  }

  const shopId = await requireShopId();
  const [expense, categories] = await Promise.all([
    getExpense(shopId, id),
    listExpenseCategories(shopId),
  ]);
  if (!expense) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={`Edit ${expense.expenseNo}`} />
      <ExpenseForm categories={categories} existing={expense} />
    </div>
  );
}
