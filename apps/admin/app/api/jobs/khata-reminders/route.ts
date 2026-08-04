import { NextResponse, type NextRequest } from "next/server";
import { listActiveShops, runKhataReminders } from "@hardware/core";
import { authorizeCron } from "../../../../lib/cron";
import { sendKhataReminder } from "../../../../lib/notify";
import { serverLogger, requestId } from "../../../../lib/logger";

// POST/GET /api/jobs/khata-reminders (route, cron/QStash-authenticated — 03 §10) —
// recompute aging and email overdue customers (Resend; runtime-deferred without
// RESEND_API_KEY). IDEMPOTENT: recomputes current state each run, so a redelivery
// produces the same overdue list (no double-charge). Authenticated by CRON_SECRET /
// QStash signature.
async function handle(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  const log = await serverLogger();
  const auth = authorizeCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: auth.reason } }, { status: 401 });
  }
  try {
    // Per-shop reminders so each tenant's overdue list and sender branding stay separate (17).
    const shops = await listActiveShops();
    const perShop = [];
    for (const shop of shops) {
      perShop.push({ shopId: shop.id, ...(await runKhataReminders(shop.id, sendKhataReminder)) });
    }
    log.info("job khata-reminders", { shops: shops.length, requestId: rid });
    return NextResponse.json({ shops: perShop, authDeferred: auth.deferred });
  } catch (e) {
    log.error("job khata-reminders failed", { err: String(e), requestId: rid });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Retry." } }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
