"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db-bridge";
import { tenantSchema } from "@/lib/validations";

export async function createTenantAction(formData: FormData) {
  await requireSession();
  const parsed = tenantSchema.safeParse({
    tenant_name: formData.get("tenant_name"),
    phone_number: formData.get("phone_number"),
    id_number: formData.get("id_number"),
    room_id: formData.get("room_id"),
    admission_date: formData.get("admission_date"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid tenant details");
  }
  await db.tenants.create(parsed.data);
  revalidatePath("/tenants");
}

export async function updateTenantAction(formData: FormData) {
  await requireSession();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const parsed = tenantSchema.safeParse({
    tenant_name: formData.get("tenant_name"),
    phone_number: formData.get("phone_number"),
    id_number: formData.get("id_number"),
    room_id: formData.get("room_id"),
  });
  if (!tenantId || !parsed.success) {
    throw new Error(parsed.success ? "Missing tenant id" : parsed.error.issues[0]?.message);
  }
  await db.tenants.update({
    tenant_id: tenantId,
    tenant_name: parsed.data.tenant_name,
    phone_number: parsed.data.phone_number,
    id_number: parsed.data.id_number,
    room_id: parsed.data.room_id,
  });
  revalidatePath("/tenants");
}

export async function deleteTenantAction(formData: FormData) {
  await requireSession();
  const tenantId = String(formData.get("tenant_id") ?? "");
  if (!tenantId) throw new Error("Missing tenant id");
  await db.tenants.delete(tenantId);
  revalidatePath("/tenants");
}
