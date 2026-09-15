"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db-bridge";
import { expenseSchema } from "@/lib/validations";

export async function createExpenseAction(formData: FormData) {
  await requireSession();
  const parsed = expenseSchema.safeParse({
    expense_name: formData.get("expense_name"),
    amount: formData.get("amount"),
    expense_date: formData.get("expense_date"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid expense details");
  }
  await db.expenses.create(parsed.data.expense_name, parsed.data.amount, parsed.data.expense_date);
  revalidatePath("/expenses");
}

export async function deleteExpenseAction(formData: FormData) {
  await requireSession();
  const expenseId = String(formData.get("expense_id") ?? "");
  if (!expenseId) throw new Error("Missing expense id");
  await db.expenses.delete(expenseId);
  revalidatePath("/expenses");
}
