"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  createExpense,
  updateExpense,
  deleteExpense,
  createExpenseCategory,
  type ExpenseDTO,
  type ExpenseCategoryDTO,
  DomainError,
  Forbidden,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";

// Expenses server actions (21b). Same shape as the rest: session → the ONE core Zod
// schema → the core service (permission + audit in its own transaction).

export interface ExpenseActionState {
  ok?: boolean;
  error?: string;
  expense?: ExpenseDTO;
}

function toError(e: unknown): string {
  if (e instanceof Forbidden) return "You do not have permission for this action.";
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the details and try again.";
  if (e instanceof DomainError) return e.message;
  return "Something went wrong. Please try again.";
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

export async function createExpenseAction(input: unknown): Promise<ExpenseActionState> {
  try {
    const expense = await createExpense(input as never, await ctx());
    revalidatePath("/expenses");
    return { ok: true, expense };
  } catch (e) {
    return { error: toError(e) };
  }
}

export async function updateExpenseAction(input: unknown): Promise<ExpenseActionState> {
  try {
    const expense = await updateExpense(input as never, await ctx());
    revalidatePath("/expenses");
    revalidatePath(`/expenses/${expense.id}/edit`);
    return { ok: true, expense };
  } catch (e) {
    return { error: toError(e) };
  }
}

export async function deleteExpenseAction(id: string): Promise<ExpenseActionState> {
  try {
    await deleteExpense(id, await ctx());
    revalidatePath("/expenses");
    return { ok: true };
  } catch (e) {
    return { error: toError(e) };
  }
}

export async function createExpenseCategoryAction(
  name: string,
): Promise<{ ok?: boolean; error?: string; category?: ExpenseCategoryDTO }> {
  try {
    const category = await createExpenseCategory({ name }, await ctx());
    revalidatePath("/expenses");
    return { ok: true, category };
  } catch (e) {
    return { error: toError(e) };
  }
}
