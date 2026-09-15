"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db-bridge";
import { areaRateSchema, areaReadingSchema } from "@/lib/validations";
import { computeWaterAmountDue } from "@/lib/invoice-service";

export async function setAreaRateAction(formData: FormData) {
  await requireSession();
  const parsed = areaRateSchema.safeParse({
    cost_per_unit: formData.get("cost_per_unit"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid rate");
  }
  await db.water.setRate(parsed.data.cost_per_unit);
  revalidatePath("/water-billing");
}

export async function createAreaReadingAction(formData: FormData) {
  await requireSession();
  const parsed = areaReadingSchema.safeParse({
    room_id: formData.get("room_id"),
    month: formData.get("month"),
    units_used: formData.get("units_used"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid reading details");
  }

  const amountDue = await computeWaterAmountDue(parsed.data.units_used);
  const month = `${parsed.data.month}-01`;

  await db.water.createReading({
    room_id: parsed.data.room_id,
    month,
    units_used: parsed.data.units_used,
    amount_due: amountDue,
  });
  revalidatePath("/water-billing");
}
