import { z } from "zod";

export const roomSchema = z.object({
  room_number: z.string().trim().min(1, "Room number is required").max(32),
  floor_number: z.string().trim().min(1, "Floor is required").max(64),
});
export type RoomInput = z.infer<typeof roomSchema>;

export const tenantSchema = z.object({
  tenant_name: z.string().trim().min(1, "Tenant name is required").max(191),
  phone_number: z.string().trim().max(32).optional().default(""),
  id_number: z.string().trim().max(64).optional().default(""),
  room_id: z.string().trim().min(1, "Room is required"),
  admission_date: z.string().trim().optional(),
});
export type TenantInput = z.infer<typeof tenantSchema>;

export const rentSchema = z.object({
  room_id: z.string().min(1, "Room is required"),
  monthly_rent: z.coerce.number().positive("Rent must be greater than 0"),
});
export type RentInput = z.infer<typeof rentSchema>;

export const areaRateSchema = z.object({
  cost_per_unit: z.coerce.number().positive("Cost per unit must be greater than 0"),
});
export type AreaRateInput = z.infer<typeof areaRateSchema>;

export const areaReadingSchema = z.object({
  room_id: z.string().min(1, "Room is required"),
  month: z.string().min(1, "Month is required"), // YYYY-MM
  units_used: z.coerce.number().nonnegative("Units used can't be negative"),
});
export type AreaReadingInput = z.infer<typeof areaReadingSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userCreateSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(64),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  id: z.string().min(1),
  username: z.string().trim().min(3).max(64).optional(),
  password: z.string().min(8).optional().or(z.literal("")),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const passwordConfirmSchema = z.object({
  password: z.string().min(1, "Password is required to confirm this action"),
});

export const expenseSchema = z.object({
  expense_name: z.string().trim().min(1, "Expense name is required").max(150),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  expense_date: z.string().min(1, "Date is required"),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;
