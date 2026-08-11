// Input shapes for Expenses (21b) — the shop's money going out that is not stock.
import { z } from "zod";

const paise = z.number().int().nonnegative();

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");

/**
 * How the money left. A closed list at the edge (so nothing arbitrary is persisted)
 * over a plain String column (so adding one later is not a migration).
 */
export const EXPENSE_PAYMENT_MODES = ["CASH", "UPI", "BANK", "CARD", "CHEQUE"] as const;
export type ExpensePaymentMode = (typeof EXPENSE_PAYMENT_MODES)[number];

/**
 * The starter categories seeded on a shop's first visit — chosen for a hardware shop
 * specifically, so the first expense can be filed without inventing a taxonomy.
 */
export const STARTER_EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Salary & Wages",
  "Transport & Freight",
  "Tea & Refreshments",
  "Repairs & Maintenance",
  "Phone & Internet",
  "Fuel",
  "Stationery & Printing",
  "Bank Charges",
  "Other",
] as const;

const gstin = z
  .string()
  .trim()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/i, "invalid GSTIN")
  .optional()
  .nullable();

const expenseBody = {
  /** Omitted ⇒ today. Back-dating is the normal case — bills are entered days later. */
  date: isoDate.optional().nullable(),
  categoryId: z.string().min(1, "Pick a category."),
  /** Free text — a landlord or the tea shop is not a Supplier record. */
  paidTo: z.string().trim().max(200).optional().nullable(),
  paymentMode: z.enum(EXPENSE_PAYMENT_MODES),
  reference: z.string().trim().max(120).optional().nullable(),
  /**
   * What actually left the till, in paise, INCLUDING any GST. One number, and the one
   * the shopkeeper knows — the taxable value is back-calculated from it.
   */
  totalAmount: paise.refine((v) => v > 0, "Enter an amount."),
  /** 0 when the bill carries no GST, which is the common case for rent or wages. */
  gstRatePct: z
    .number()
    .min(0)
    .max(50)
    .optional()
    .default(0),
  /** True when the supplier is in another state — IGST rather than CGST+SGST. */
  interState: z.boolean().optional().default(false),
  supplierGstin: gstin,
  notes: z.string().trim().max(1000).optional().nullable(),
};

export const createExpenseSchema = z.object(expenseBody);
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z.object({ id: z.string().min(1), ...expenseBody });
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  categoryId: z.string().min(1).optional(),
  paymentMode: z.enum(EXPENSE_PAYMENT_MODES).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(100),
});
export type ListExpensesQuery = z.input<typeof listExpensesQuerySchema>;

export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(2, "Give the category a name.").max(60),
});
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
