import { NextResponse, type NextRequest } from "next/server";
import { runKhataReminders } from "@hardware/core";
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
    const result = await runKhataReminders(sendKhataReminder);
    log.info("job khata-reminders", { overdue: result.overdue.length, reminded: result.reminded, requestId: rid });
    return NextResponse.json({ ...result, authDeferred: auth.deferred });
  } catch (e) {
    log.error("job khata-reminders failed", { err: String(e), requestId: rid });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Retry." } }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
