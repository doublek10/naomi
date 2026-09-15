/**
 * lib/invoice-service.ts
 *
 * Business logic — invoice generation, water billing math, webhook
 * reconciliation — kept out of database.php (which stays a dumb CRUD
 * layer) and out of the UI pages. Written against your REAL schema:
 *   - invoice has `area_balance`, not a separate "water_balance" +
 *     "carried_balance" pair. There's no column on `invoice` itself that
 *     stores the prior month's carried-over balance.
 *   - `balance_sheet` is where that carry-forward actually lives:
 *     balance = amount_paid - total_amount, written once an invoice is
 *     fully paid (see upsertBalanceSheet in database.php). Positive =
 *     credit to apply next month, negative = still owed.
 */

import { db, type Invoice } from "./db-bridge";

/** "2026-09-13" -> "2026-09-01" (first of the month, as MySQL DATE) */
export function monthStart(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function currentDayOfMonth(date: Date = new Date()): number {
  return date.getUTCDate();
}

/**
 * The dashboard's "payments this month" figure follows your rule: it counts
 * from the 1st, but resets to 0 (starts counting fresh) from the 25th
 * onward, rather than continuing to include everything since the 1st.
 */
export function dashboardPaymentsWindowStart(date: Date = new Date()): string {
  const day = currentDayOfMonth(date);
  if (day < 25) return monthStart(date);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-25`;
}

// ---------------------------------------------------------------------
// Water billing
// ---------------------------------------------------------------------
export async function computeWaterAmountDue(unitsUsed: number): Promise<number> {
  const rate = await db.water.currentRate();
  if (!rate) {
    throw new Error(
      "No water rate is configured yet — set a cost-per-unit under Water Billing before entering readings."
    );
  }
  const costPerUnit = Number(rate.cost_per_unit);
  return Math.round(unitsUsed * costPerUnit * 100) / 100;
}

// ---------------------------------------------------------------------
// Invoice generation
// ---------------------------------------------------------------------
export interface GeneratedInvoiceSummary {
  room_number: string;
  total_amount?: number;
  skipped?: string;
}

/**
 * Carried balance for a room going INTO `month`: the balance_sheet row for
 * that room's most recent PRIOR invoice, if one exists. Falls back to 0 if
 * the prior invoice was never marked paid (no balance_sheet row yet) — an
 * unpaid prior invoice's full total_amount will show up on its own as a
 * still-pending invoice, so it isn't double counted here.
 */
async function carriedBalanceForRoom(room_id: string, month: string): Promise<number> {
  const priorInvoice = await db.invoices.latestForRoom(room_id, month);
  if (!priorInvoice) return 0;

  const balanceRow = await db.invoices.balanceSheetFor(priorInvoice.invoice_id);
  if (!balanceRow) return 0;

  return Number(balanceRow.balance);
}

/**
 * Generates invoices for every occupied room for `month` (YYYY-MM-01).
 * total_amount = monthly_rent + this month's water (area) balance + any
 * carried balance from the room's last paid invoice.
 *
 * Refuses to run if invoices already exist for this month (prevents
 * duplicates) — check `invoicesExistForMonth` yourself first for a
 * friendlier message before calling this.
 */
export async function generateInvoicesForMonth(
  month: string
): Promise<GeneratedInvoiceSummary[]> {
  const { exists } = await db.invoices.existForMonth(month);
  if (exists) {
    throw new Error(`Invoices for ${month} already exist — regeneration is blocked to avoid duplicates.`);
  }

  const occupiedRooms = await db.invoices.roomsWithTenants();
  const results: GeneratedInvoiceSummary[] = [];

  for (const room of occupiedRooms) {
    if (!room.monthly_rent) {
      results.push({ room_number: room.room_number, skipped: "No rent amount is set for this room yet" });
      continue;
    }

    const monthlyRent = Number(room.monthly_rent);

    const waterBalance = await db.water.balanceForRoomMonth(room.room_id, month);
    const areaBalance = waterBalance
      ? Number(waterBalance.amount_due) - Number(waterBalance.amount_paid)
      : 0;

    const carried = await carriedBalanceForRoom(room.room_id, month);

    const totalAmount = Math.round((monthlyRent - carried + areaBalance) * 100) / 100;
    // carried is positive-as-credit (amount_paid - total_amount last time),
    // so a credit REDUCES this month's total — hence subtracting it.

    await db.invoices.create({
      invoice_month: month,
      room_id: room.room_id,
      tenant_id: room.tenant_id,
      monthly_rent: monthlyRent,
      area_balance: areaBalance,
      total_amount: totalAmount,
    });

    results.push({ room_number: room.room_number, total_amount: totalAmount });
  }

  return results;
}

/** Manual regeneration is only allowed the 1st–15th of the month. */
export function isManualRegenerationWindowOpen(date: Date = new Date()): boolean {
  const day = currentDayOfMonth(date);
  return day >= 1 && day <= 15;
}

/**
 * Runs on the 25th of each month (see app/api/cron/close-month). Writes a
 * balance_sheet row for every invoice generated this month, whatever its
 * status — this is what lets the 1st-of-next-month generation carry
 * forward what's still owed (or overpaid) per room.
 */
export async function closeMonthAndCarryForward(month: string) {
  return db.invoices.closeMonthBalances(month);
}

// ---------------------------------------------------------------------
// Webhook reconciliation
// ---------------------------------------------------------------------
export interface KcbWebhookPayload {
  transactionID?: string;
  debitMSISDN?: string;
  transactionAmt?: string | number;
  businessKey?: string;
  [key: string]: unknown;
}

export interface ReconciliationResult {
  matched: boolean;
  roomNumber: string | null;
  invoiceId: string | null;
  amount: number;
  note: string;
}

/** businessKey format confirmed from your webhook_queue data: "<key>#<room_number>" */
function extractRoomNumber(businessKey: string | undefined): string | null {
  if (!businessKey || !businessKey.includes("#")) return null;
  const [, roomNumber] = businessKey.split("#");
  return roomNumber?.trim() || null;
}

/**
 * Payments below KES 5,000 are treated as water top-ups against `bbilt`
 * only — the linked invoice is never touched. Payments of 5,000 or more are
 * treated as rent, applied straight to the room's open invoice for this
 * month (pending -> paid once covered).
 */
const RENT_PAYMENT_THRESHOLD = 5000;

async function recordWaterTopUp(
  roomNumber: string,
  amount: number,
  mpesaNumber: string,
  mpesaCode: string
): Promise<void> {
  const month = monthStart();
  const existing = await db.bbilt.findForRoomMonth(roomNumber, month);

  if (existing) {
    await db.bbilt.updatePayment({
      id: existing.id,
      amount_paid_delta: amount,
      mpesa_number: mpesaNumber,
      mpesa_code: mpesaCode,
    });
    return;
  }

  // No bbilt row for this room yet this month — create one. If the room has
  // a water reading on file for this month, use its amount_due as the
  // target; otherwise 0 (still logged, just with nothing to compare against
  // yet).
  const rooms = await db.rooms.list();
  const room = rooms.find((r) => r.room_number === roomNumber);
  let targetAmount = 0;
  if (room) {
    const waterBalance = await db.water.balanceForRoomMonth(room.room_id, month);
    targetAmount = waterBalance ? Number(waterBalance.amount_due) : 0;
  }

  await db.bbilt.create({
    room_number: roomNumber,
    amount: targetAmount,
    amount_paid: amount,
    mpesa_number: mpesaNumber,
    mpesa_code: mpesaCode,
  });
}

export async function reconcileWebhookPayload(
  payload: KcbWebhookPayload
): Promise<ReconciliationResult> {
  const amount = Number(payload.transactionAmt ?? 0);
  const roomNumber = extractRoomNumber(payload.businessKey);
  const mpesaCode = String(payload.transactionID ?? "");
  const phoneNumber = String(payload.debitMSISDN ?? "");

  if (!roomNumber || !Number.isFinite(amount) || amount <= 0) {
    return {
      matched: false,
      roomNumber,
      invoiceId: null,
      amount,
      note: "Could not parse a room number or valid amount from businessKey",
    };
  }

  // Under the threshold: water top-up on bbilt only, invoice untouched.
  if (amount < RENT_PAYMENT_THRESHOLD) {
    await recordWaterTopUp(roomNumber, amount, phoneNumber, mpesaCode);
    return {
      matched: true,
      roomNumber,
      invoiceId: null,
      amount,
      note: "Under KES 5,000 — recorded as a water top-up on bbilt",
    };
  }

  // 5,000 and above: treat as rent, apply to this room's open invoice.
  const rooms = await db.rooms.list();
  const room = rooms.find((r) => r.room_number === roomNumber);

  if (!room) {
    return { matched: false, roomNumber, invoiceId: null, amount, note: "No room with this number exists" };
  }

  const month = monthStart();
  const invoicesThisMonth = await db.invoices.forMonth(month);
  const openInvoice: Invoice | undefined = invoicesThisMonth.find(
    (inv) => inv.room_id === room.room_id && inv.status !== "paid"
  );

  if (!openInvoice) {
    return {
      matched: false,
      roomNumber,
      invoiceId: null,
      amount,
      note: "No pending invoice for this room this month — needs manual review",
    };
  }

  await db.invoices.applyPayment({
    invoice_id: openInvoice.invoice_id,
    amount,
    mpesa_code: mpesaCode,
    phone_number: phoneNumber,
  });

  return {
    matched: true,
    roomNumber,
    invoiceId: openInvoice.invoice_id,
    amount,
    note: `Applied to invoice ${openInvoice.invoice_id}`,
  };
}

/**
 * Drains up to `limit` unprocessed webhook_queue rows and reconciles each.
 * Meant to be called from app/api/cron/process-webhooks.
 */
export async function processWebhookQueue(limit = 50) {
  const rows = await db.webhookQueue.listUnprocessed(limit);
  const outcomes: { id: number; result: ReconciliationResult }[] = [];

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.request_data);
    } catch {
      await db.webhookQueue.markProcessed(row.id);
      continue;
    }

    // KCB payloads (per your webhook_queue sample data) nest the actual
    // fields under requestPayload.additionalData.notificationData.
    const notification =
      (parsed as any)?.requestPayload?.additionalData?.notificationData ?? parsed;

    const result = await reconcileWebhookPayload(notification as KcbWebhookPayload);
    await db.webhookQueue.markProcessed(row.id);
    outcomes.push({ id: row.id, result });
  }

  return outcomes;
}
