import { NextResponse, type NextRequest } from "next/server";
import { runReservationExpiry } from "@hardware/core";
import { authorizeCron } from "../../../../lib/cron";
import { serverLogger, requestId } from "../../../../lib/logger";

// POST /api/jobs/reservation-expiry (route, cron/QStash-authenticated — 03 §10) —
// release reservations past expiry, freeing available stock. IDEMPOTENT: a redelivery
// releases nothing more. Authenticated by CRON_SECRET / QStash signature (auth runtime-
// deferred when CRON_SECRET is empty — flagged in the response). GET is allowed too so
// Vercel Cron (which issues GET) can trigger it.
async function handle(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  const log = await serverLogger();
  const auth = authorizeCron(req);
  if (!auth.ok) {
    log.warn("cron rejected: reservation-expiry", { reason: auth.reason, requestId: rid });
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: auth.reason } }, { status: 401 });
  }
  try {
    const result = await runReservationExpiry();
    log.info("job reservation-expiry", { released: result.released, deferred: auth.deferred, requestId: rid });
    return NextResponse.json({ ...result, authDeferred: auth.deferred });
  } catch (e) {
    // 500 so QStash retries (the job is idempotent → a safe retry).
    log.error("job reservation-expiry failed", { err: String(e), requestId: rid });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Retry." } }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
