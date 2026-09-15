import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-bridge";
import { generateInvoicesForMonth, monthStart } from "@/lib/invoice-service";

/**
 * GET /api/cron/generate-invoices
 *
 * Replaces the original's "runs as a side effect of loading payments.php on
 * the 1st" with an actual scheduled job (see rebuild-spec.md §3.6). Schedule
 * this in vercel.json to run once, early, on the 1st of each month — it's
 * idempotent (guarded by invoicesExistForMonth), so an extra accidental
 * trigger is harmless.
 *
 * Protected by CRON_SECRET (Vercel Cron sends this automatically for routes
 * configured in vercel.json).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const month = monthStart();
  const { exists } = await db.invoices.existForMonth(month);
  if (exists) {
    return NextResponse.json({ skipped: true, reason: "Invoices already exist for this month", month });
  }

  const results = await generateInvoicesForMonth(month);
  return NextResponse.json({ month, generated: results.length, results });
}
