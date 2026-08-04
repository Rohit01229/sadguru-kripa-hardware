import { NextResponse, type NextRequest } from "next/server";
import { listActiveShops, runDayEndRollup } from "@hardware/core";
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
    // Per-tenant roll-up: one summary per shop (17). Trivial while a single shop exists.
    const shops = await listActiveShops();
    const perShop = [];
    for (const shop of shops) {
      perShop.push({ shopId: shop.id, ...(await runDayEndRollup(shop.id)) });
    }
    log.info("job day-end", { shops: shops.length, requestId: rid });
    return NextResponse.json({ shops: perShop, authDeferred: auth.deferred });
  } catch (e) {
    log.error("job day-end failed", { err: String(e), requestId: rid });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Retry." } }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
