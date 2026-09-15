import { NextRequest, NextResponse } from "next/server";
import { closeMonthAndCarryForward, monthStart } from "@/lib/invoice-service";

/**
 * GET /api/cron/close-month
 *
 * Runs on the 25th of each month. Writes a balance_sheet row for every
 * invoice generated this month (paid or not) — see the comment on
 * closeMonthBalances in database.php. This is what lets next month's
 * generation on the 1st correctly add/subtract each room's outstanding
 * balance.
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
  const result = await closeMonthAndCarryForward(month);
  return NextResponse.json({ month, ...result });
}
