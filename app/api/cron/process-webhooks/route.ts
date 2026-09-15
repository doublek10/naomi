import { NextRequest, NextResponse } from "next/server";
import { processWebhookQueue } from "@/lib/invoice-service";

/**
 * GET /api/cron/process-webhooks
 *
 * Once-daily safety net (Vercel Hobby plan only allows daily cron
 * schedules — real-time reconciliation now happens inline in
 * app/api/webhooks/kcb/route.ts instead). This just mops up any
 * webhook_queue row still sitting at processed = 0 — e.g. one where the
 * inline reconciliation in the webhook route threw, or the bridge was
 * briefly unreachable at the moment the payment came in.
 *
 * Protected by CRON_SECRET, which Vercel Cron automatically sends as
 * `Authorization: Bearer $CRON_SECRET` for routes listed in vercel.json.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outcomes = await processWebhookQueue(50);
  return NextResponse.json({ processed: outcomes.length, outcomes });
}
