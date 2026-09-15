import { NextRequest, NextResponse } from "next/server";
import { reconcileWebhookPayload, type KcbWebhookPayload } from "@/lib/invoice-service";

/**
 * POST /api/webhooks/kcb
 *
 * Storing the raw KCB payload into `webhook_queue` is already handled
 * elsewhere (a separate existing integration), so this route does NOT
 * duplicate that write. Its only job is to reconcile the payment
 * immediately, using the payload from this request directly — apply the
 * >=5,000 rent / <5,000 water split (see reconcileWebhookPayload in
 * lib/invoice-service.ts) — and return the ack the bank expects.
 *
 * `/api/cron/process-webhooks` still runs once a day (Vercel Hobby plan
 * only allows daily cron schedules) as a catch-up pass over whatever is
 * sitting in `webhook_queue` with `processed = 0` — covering anything the
 * other integration stored that never reached this route, or where
 * reconciliation here failed.
 *
 * IMPORTANT — the exact ack field names/shape below (messageID,
 * originatorConversationID, statusCode) are inferred from your
 * webhook_queue sample payload's `header` block, not an official KCB spec.
 * Confirm against KCB's actual API docs before relying on this.
 *
 * If KCB_WEBHOOK_SECRET is set, requires it as a header or query param
 * before accepting the call. Otherwise, rely on IP-allowlisting at the
 * platform/firewall level.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.KCB_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers.get("x-webhook-secret") ?? req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ statusCode: "401", error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ statusCode: "400", error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const body = payload as Record<string, unknown>;
    const notification =
      (body?.requestPayload as any)?.additionalData?.notificationData ?? payload;
    await reconcileWebhookPayload(notification as KcbWebhookPayload);
  } catch (err) {
    // Don't fail the ack over a reconciliation error on our end — whatever
    // stored this payload into webhook_queue will still have it there for
    // the daily catch-up cron to retry.
    console.error("Inline webhook reconciliation failed", err);
  }

  const body = payload as Record<string, unknown>;
  const header = (body?.header as Record<string, unknown>) ?? {};
  return NextResponse.json({
    messageID: header.messageID ?? null,
    originatorConversationID: header.originatorConversationID ?? null,
    statusCode: "0",
    statusMessage: "Success",
  });
}
