import { NextResponse, type NextRequest } from "next/server";
import { listActiveShops, runBatchReconciliation } from "@hardware/core";
import { authorizeCron } from "../../../../lib/cron";
import { serverLogger, requestId } from "../../../../lib/logger";

// POST/GET /api/jobs/reconcile-batches (route, cron/QStash-authenticated — 03 §10,
// 13 §5) — detect (and optionally repair, ?repair=true) drift between Σ(Batch.onHand)
// and ProductStock.onHand. DETECT-ONLY by default so the owner reviews before any
// auto-fix. Idempotent: a clean product produces no drift; a re-run after repair finds
// nothing. Authenticated by CRON_SECRET / QStash signature.
async function handle(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  const log = await serverLogger();
  const auth = authorizeCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: auth.reason } }, { status: 401 });
  }
  try {
    const repair = req.nextUrl.searchParams.get("repair") === "true";
    // Reconcile batch drift per shop (17); product→shop is immutable so no cross-tenant mixing.
    const shops = await listActiveShops();
    const perShop = [];
    for (const shop of shops) {
      perShop.push({ shopId: shop.id, ...(await runBatchReconciliation(shop.id, repair)) });
    }
    log.info("job reconcile-batches", { shops: shops.length, repair, requestId: rid });
    return NextResponse.json({ shops: perShop, repair, authDeferred: auth.deferred });
  } catch (e) {
    log.error("job reconcile-batches failed", { err: String(e), requestId: rid });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Retry." } }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
