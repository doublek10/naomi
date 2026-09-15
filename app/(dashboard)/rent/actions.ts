"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db-bridge";
import { rentSchema } from "@/lib/validations";

export async function upsertRentAction(formData: FormData) {
  await requireSession();
  const parsed = rentSchema.safeParse({
    room_id: formData.get("room_id"),
    monthly_rent: formData.get("monthly_rent"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid rent details");
  }
  await db.rent.upsert(parsed.data.room_id, parsed.data.monthly_rent);
  revalidatePath("/rent");
}
