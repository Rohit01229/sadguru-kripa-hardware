import { NextResponse, type NextRequest } from "next/server";
import { runBackup } from "@hardware/core";
import { authorizeCron } from "../../../../lib/cron";
import { serverLogger, requestId } from "../../../../lib/logger";

// POST/GET /api/jobs/backup (route, cron/QStash-authenticated — 03 §10, 05) —
// encrypted pg_dump → R2 with 6-year retention. RUNTIME-DEFERRED when R2 creds are
// empty: returns { deferred:true } and never throws. The actual dump pipeline runs on
// a worker/VPS with pg_dump, not the serverless runtime. Authenticated by CRON_SECRET /
// QStash signature.
async function handle(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  const log = await serverLogger();
  const auth = authorizeCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: auth.reason } }, { status: 401 });
  }
  const result = await runBackup();
  log.info("job backup", { ran: result.ran, deferred: result.deferred, objectKey: result.plan.objectKey, requestId: rid });
  return NextResponse.json({ ...result, authDeferred: auth.deferred });
}

export const POST = handle;
export const GET = handle;
