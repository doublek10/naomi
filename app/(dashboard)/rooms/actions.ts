"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db-bridge";
import { roomSchema } from "@/lib/validations";

export async function createRoomAction(formData: FormData) {
  await requireSession();
  const parsed = roomSchema.safeParse({
    room_number: formData.get("room_number"),
    floor_number: formData.get("floor_number"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid room details");
  }
  await db.rooms.create(parsed.data.room_number, parsed.data.floor_number);
  revalidatePath("/rooms");
}

export async function updateRoomAction(formData: FormData) {
  await requireSession();
  const roomId = String(formData.get("room_id") ?? "");
  const parsed = roomSchema.safeParse({
    room_number: formData.get("room_number"),
    floor_number: formData.get("floor_number"),
  });
  if (!roomId || !parsed.success) {
    throw new Error(parsed.success ? "Missing room id" : parsed.error.issues[0]?.message);
  }
  await db.rooms.update(roomId, parsed.data.room_number, parsed.data.floor_number);
  revalidatePath("/rooms");
}

export async function deleteRoomAction(formData: FormData) {
  await requireSession();
  const roomId = String(formData.get("room_id") ?? "");
  if (!roomId) throw new Error("Missing room id");
  await db.rooms.delete(roomId);
  revalidatePath("/rooms");
}
