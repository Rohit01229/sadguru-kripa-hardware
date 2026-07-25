import { NextResponse, type NextRequest } from "next/server";
import { runDayEndRollup } from "@hardware/core";
import { authorizeCron } from "../../../../lib/cron";
import { serverLogger, requestId } from "../../../../lib/logger";

// POST/GET /api/jobs/day-end (route, cron/QStash-authenticated — 03 §10) — nightly
// roll-up snapshot of the PRIOR day's pakka summary (kacha excluded). Read-only →
// trivially idempotent. Authenticated by CRON_SECRET / QStash signature.
async function handle(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  const log = await serverLogger();
  const auth = authorizeCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: auth.reason } }, { status: 401 });
  }
  try {
    const result = await runDayEndRollup();
    log.info("job day-end", { date: result.summary.date, grandTotal: result.summary.grandTotal, requestId: rid });
    return NextResponse.json({ ...result, authDeferred: auth.deferred });
  } catch (e) {
    log.error("job day-end failed", { err: String(e), requestId: rid });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Retry." } }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
