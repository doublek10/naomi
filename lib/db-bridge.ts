/**
 * lib/db-bridge.ts
 *
 * The ONLY module in the Next.js app that knows how to reach the database —
 * and it doesn't touch MySQL directly. It calls database.php on cPanel over
 * HTTPS. Types here mirror your EXISTING schema (rxtdhqwu_house_rental_db)
 * exactly — no renamed columns, no invented tables.
 *
 * Required env vars (Vercel project settings, NOT prefixed with NEXT_PUBLIC_
 * since this must never run in the browser):
 *   DB_BRIDGE_URL       e.g. "https://danasresidency.co.ke/api/database.php"
 *   DB_BRIDGE_API_KEY   the shared secret configured in database.php
 */

import "server-only";

const DB_BRIDGE_URL = process.env.DB_BRIDGE_URL;
const DB_BRIDGE_API_KEY = process.env.DB_BRIDGE_API_KEY;

if (!DB_BRIDGE_URL || !DB_BRIDGE_API_KEY) {
  throw new Error(
    "DB_BRIDGE_URL and DB_BRIDGE_API_KEY must be set in the environment"
  );
}

type BridgeResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export class BridgeError extends Error {
  constructor(public action: string, message: string, public status?: number) {
    super(`db-bridge: ${action} failed — ${message}`);
    this.name = "BridgeError";
  }
}

async function callBridge<T>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(DB_BRIDGE_URL as string, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": DB_BRIDGE_API_KEY as string,
    },
    body: JSON.stringify({ action, params }),
    cache: "no-store",
  });

  let json: BridgeResponse<T>;
  try {
    json = (await res.json()) as BridgeResponse<T>;
  } catch {
    throw new BridgeError(action, `Non-JSON response (${res.status})`, res.status);
  }

  if (!res.ok || !json.ok) {
    const message = "error" in json ? json.error : `Bridge call failed (${res.status})`;
    throw new BridgeError(action, message, res.status);
  }

  return json.data;
}

// ---------------------------------------------------------------------
// Types — mirror your real columns. MySQL DECIMAL always comes back as a
// numeric string over JSON, so those are typed `string`.
// ---------------------------------------------------------------------
export interface Room {
  room_id: string;
  room_number: string;
  floor_number: string;
}

export interface Tenant {
  tenant_id: string;
  room_id: string;
  tenant_name: string;
  phone_number: string | null;
  ID_number: string | null;
  room_number?: string;
  admission_date?: string | null;
}

export interface RentAmount {
  rent_id: string;
  room_id: string;
  monthly_rent: string;
  room_number?: string;
  floor_number?: string;
}

export interface AreaRate {
  multiplier_id: string;
  cost_per_unit: string;
}

export interface AreaReading {
  area_id: string;
  room_id: string;
  month: string;
  area_type: string;
  units_used: string;
  amount_due: string | null;
  amount_paid: string | null;
  room_number: string;
}

export interface RoomWithTenant {
  room_id: string;
  room_number: string;
  tenant_id: string;
  monthly_rent: string | null;
}

export type InvoiceStatus = "pending" | "paid" | "waiting";

export interface Invoice {
  invoice_id: string;
  invoice_month: string;
  status: InvoiceStatus;
  room_id: string;
  tenant_id: string | null;
  monthly_rent: string;
  area_balance: string;
  total_amount: string;
  created_at: string;
  mpesa_code: string | null;
  number: string | null;
  amount_paid: string;
  updated_at: string;
  room_number?: string;
  tenant_name?: string | null;
  phone_number?: string | null;
}

export interface BalanceSheetRow {
  id: number;
  invoice_id: string;
  balance: string;
  created_at: string;
  status: string;
}

export interface BbiltEntry {
  id: number;
  room_number: string;
  amount: string;
  amount_paid: string;
  mpesa_number: string;
  mpesa_code: string;
  created_at: string;
}

export interface Expense {
  expense_id: string;
  expense_name: string;
  amount: string;
  expense_date: string;
}

export interface AdminUser {
  id: number;
  username: string;
  password: string; // md5 (legacy) or bcrypt, auto-upgraded on login
}

export interface AdminUserSummary {
  id: number;
  username: string;
}

export interface WebhookQueueRow {
  id: number;
  request_data: string;
  processed: 0 | 1;
  created_at: string;
  processed_at: string | null;
}

// ---------------------------------------------------------------------
// Typed helpers — one per action exposed by database.php
// ---------------------------------------------------------------------
export const db = {
  rooms: {
    list: () => callBridge<Room[]>("getRooms"),
    get: (room_id: string) => callBridge<Room | null>("getRoom", { room_id }),
    create: (room_number: string, floor_number: string) =>
      callBridge<{ room_id: string }>("createRoom", { room_number, floor_number }),
    update: (room_id: string, room_number: string, floor_number: string) =>
      callBridge<{ updated: boolean }>("updateRoom", { room_id, room_number, floor_number }),
    delete: (room_id: string) => callBridge<{ deleted: boolean }>("deleteRoom", { room_id }),
  },

  tenants: {
    list: () => callBridge<Tenant[]>("getTenants"),
    get: (tenant_id: string) => callBridge<Tenant | null>("getTenant", { tenant_id }),
    create: (input: {
      tenant_name: string;
      phone_number?: string;
      id_number?: string;
      room_id: string; // required — tenants.room_id is NOT NULL
      admission_date?: string;
    }) => callBridge<{ tenant_id: string }>("createTenant", input),
    update: (input: {
      tenant_id: string;
      tenant_name: string;
      phone_number?: string;
      id_number?: string;
      room_id: string;
    }) => callBridge<{ updated: boolean }>("updateTenant", input),
    delete: (tenant_id: string) => callBridge<{ deleted: boolean }>("deleteTenant", { tenant_id }),
  },

  rent: {
    list: () => callBridge<RentAmount[]>("getRentAmounts"),
    forRoom: (room_id: string) => callBridge<RentAmount | null>("getRentForRoom", { room_id }),
    upsert: (room_id: string, monthly_rent: number) =>
      callBridge<{ rent_id: string; room_id: string; monthly_rent: number }>("upsertRentAmount", {
        room_id,
        monthly_rent,
      }),
  },

  water: {
    // area_multipliers is a single settings row in your schema — no rate
    // history/effective-date support exists (unlike an earlier draft of
    // this rebuild assumed).
    currentRate: () => callBridge<AreaRate | null>("getCurrentAreaRate"),
    setRate: (cost_per_unit: number) =>
      callBridge<{ multiplier_id: string; cost_per_unit: number }>("setAreaRate", { cost_per_unit }),
    readingsForMonth: (month: string) =>
      callBridge<AreaReading[]>("getAreasForMonth", { month }),
    createReading: (input: {
      room_id: string;
      month: string;
      units_used: number;
      amount_due: number;
      area_type?: string;
    }) => callBridge<{ area_id: string; balance_id: string }>("createAreaReading", input),
    balanceForRoomMonth: (room_id: string, month: string) =>
      callBridge<{ amount_due: string; amount_paid: string } | null>(
        "getWaterBalanceForRoomMonth",
        { room_id, month }
      ),
  },

  invoices: {
    forMonth: (month: string) => callBridge<Invoice[]>("getInvoicesForMonth", { month }),
    latestForRoom: (room_id: string, before_month: string) =>
      callBridge<Invoice | null>("getLatestInvoiceForRoom", { room_id, before_month }),
    balanceSheetFor: (invoice_id: string) =>
      callBridge<BalanceSheetRow | null>("getBalanceSheetForInvoice", { invoice_id }),
    roomsWithTenants: () => callBridge<RoomWithTenant[]>("roomsWithTenants"),
    existForMonth: (month: string) =>
      callBridge<{ exists: boolean }>("invoicesExistForMonth", { month }),
    create: (input: {
      invoice_month: string;
      room_id: string;
      tenant_id?: string | null;
      monthly_rent: number;
      area_balance: number;
      total_amount: number;
    }) => callBridge<{ id: string }>("createInvoice", input),
    markPaid: (invoice_id: string) =>
      callBridge<{ updated: boolean }>("markInvoicePaid", { invoice_id }),
    markAllPaidForMonth: (month: string) =>
      callBridge<{ updated_rows: number }>("markAllInvoicesPaidForMonth", { month }),
    closeMonthBalances: (month: string) =>
      callBridge<{ closed: number }>("closeMonthBalances", { month }),
    applyPayment: (input: {
      invoice_id: string;
      amount: number;
      mpesa_code?: string;
      phone_number?: string;
    }) => callBridge<{ updated: boolean }>("applyPaymentToInvoice", input),
  },

  bbilt: {
    create: (input: {
      room_number: string;
      amount: number;
      amount_paid: number;
      mpesa_number?: string;
      mpesa_code?: string;
    }) => callBridge<{ id: number }>("createBbiltEntry", input),
    recent: (limit = 50) => callBridge<BbiltEntry[]>("getRecentBbilt", { limit }),
    findForRoomMonth: (room_number: string, month_start: string) =>
      callBridge<BbiltEntry | null>("findBbiltForRoomMonth", { room_number, month_start }),
    updatePayment: (input: {
      id: number;
      amount_paid_delta: number;
      mpesa_number?: string;
      mpesa_code?: string;
    }) => callBridge<{ updated: boolean }>("updateBbiltPayment", input),
  },

  expenses: {
    list: () => callBridge<Expense[]>("getExpenses"),
    create: (expense_name: string, amount: number, expense_date: string) =>
      callBridge<{ expense_id: string }>("createExpense", { expense_name, amount, expense_date }),
    delete: (expense_id: string) => callBridge<{ deleted: boolean }>("deleteExpense", { expense_id }),
  },

  dashboard: {
    counts: (month_start: string) =>
      callBridge<{ room_count: number; tenant_count: number; payments_this_month: number }>(
        "dashboardCounts",
        { month_start }
      ),
  },

  users: {
    getByUsername: (username: string) =>
      callBridge<AdminUser | null>("getUserByUsername", { username }),
    list: () => callBridge<AdminUserSummary[]>("getUsers"),
    count: () => callBridge<{ count: number }>("countUsers"),
    create: (username: string, password_hash: string) =>
      callBridge<{ id: number }>("createUser", { username, password_hash }),
    update: (input: { id: number | string; username?: string; password_hash?: string }) =>
      callBridge<{ updated: boolean }>("updateUser", input),
    delete: (id: number | string) => callBridge<{ deleted: boolean }>("deleteUser", { id }),
  },

  webhookQueue: {
    enqueue: (request_data: unknown) =>
      callBridge<{ id: number }>("enqueueWebhook", { request_data }),
    listUnprocessed: (limit = 50) =>
      callBridge<WebhookQueueRow[]>("getUnprocessedWebhooks", { limit }),
    markProcessed: (id: number) => callBridge<{ updated: boolean }>("markWebhookProcessed", { id }),
  },
};
