import { NextResponse, type NextRequest } from "next/server";
import { runLowStockAlerts, runNearExpiryAlerts } from "@hardware/core";
import { authorizeCron } from "../../../../lib/cron";
import { serverLogger, requestId } from "../../../../lib/logger";

// POST/GET /api/jobs/stock-alerts (route, cron/QStash-authenticated — 03 §10) — daily
// low-stock + near-expiry alert collection. Both read-only → idempotent. Authenticated
// by CRON_SECRET / QStash signature. Returns both alert lists in one call (one cron arm).
async function handle(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  const log = await serverLogger();
  const auth = authorizeCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: auth.reason } }, { status: 401 });
  }
  try {
    const lowStock = await runLowStockAlerts();
    const nearExpiry = await runNearExpiryAlerts();
    log.info("job stock-alerts", { lowStock: lowStock.count, nearExpiry: nearExpiry.count, requestId: rid });
    return NextResponse.json({ lowStock, nearExpiry, authDeferred: auth.deferred });
  } catch (e) {
    log.error("job stock-alerts failed", { err: String(e), requestId: rid });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Retry." } }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
