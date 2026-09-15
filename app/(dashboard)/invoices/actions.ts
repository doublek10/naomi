"use server";

import { revalidatePath } from "next/cache";
import { requireSession, verifyCurrentUserPassword } from "@/lib/auth";
import { db } from "@/lib/db-bridge";
import { passwordConfirmSchema } from "@/lib/validations";
import {
  generateInvoicesForMonth,
  isManualRegenerationWindowOpen,
  monthStart,
} from "@/lib/invoice-service";

export async function generateInvoicesAction(formData: FormData) {
  await requireSession();
  const month = String(formData.get("month") ?? monthStart());

  const isCurrentMonth = month === monthStart();
  if (isCurrentMonth && !isManualRegenerationWindowOpen()) {
    throw new Error(
      "Manual invoice generation for the current month is only allowed between the 1st and 15th."
    );
  }

  await generateInvoicesForMonth(month);
  revalidatePath("/invoices");
}

export async function markInvoicePaidAction(formData: FormData) {
  await requireSession();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const parsed = passwordConfirmSchema.safeParse({ password: formData.get("password") });

  if (!invoiceId) throw new Error("Missing invoice id");
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);

  const valid = await verifyCurrentUserPassword(parsed.data.password);
  if (!valid) throw new Error("Incorrect password — invoice was not marked paid.");

  await db.invoices.markPaid(invoiceId);
  revalidatePath("/invoices");
}

export async function markAllPaidAction(formData: FormData) {
  await requireSession();
  const month = String(formData.get("month") ?? monthStart());
  const parsed = passwordConfirmSchema.safeParse({ password: formData.get("password") });

  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);

  const valid = await verifyCurrentUserPassword(parsed.data.password);
  if (!valid) throw new Error("Incorrect password — invoices were not marked paid.");

  await db.invoices.markAllPaidForMonth(month);
  revalidatePath("/invoices");
}
