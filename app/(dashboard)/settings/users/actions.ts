"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db-bridge";
import { userCreateSchema, userUpdateSchema } from "@/lib/validations";

const SALT_ROUNDS = 10;

export async function createUserAction(formData: FormData) {
  await requireSession();
  const parsed = userCreateSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid user details");
  }
  const hash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);
  await db.users.create(parsed.data.username, hash);
  revalidatePath("/settings/users");
}

export async function updateUserAction(formData: FormData) {
  await requireSession();
  const parsed = userUpdateSchema.safeParse({
    id: formData.get("id"),
    username: formData.get("username") || undefined,
    password: formData.get("password") || "",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid user details");
  }

  const passwordHash = parsed.data.password
    ? await bcrypt.hash(parsed.data.password, SALT_ROUNDS)
    : undefined;

  await db.users.update({
    id: parsed.data.id,
    username: parsed.data.username,
    password_hash: passwordHash,
  });
  revalidatePath("/settings/users");
}

export async function deleteUserAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing user id");

  const { count } = await db.users.count();
  if (count <= 1) {
    throw new Error("Can't delete the last remaining admin user.");
  }

  await db.users.delete(id);
  revalidatePath("/settings/users");
}
