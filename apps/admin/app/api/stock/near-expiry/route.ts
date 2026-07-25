import { NextResponse, type NextRequest } from "next/server";
import { nearExpiry, requirePermission, nearExpiryQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/stock/near-expiry (route, 🔒S [stock.read]) — batches expiring within
// `withinDays` (default 30) that still hold stock, soonest first. Source for the
// 03 §10 near-expiry alert job.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "stock.read");

    const sp = req.nextUrl.searchParams;
    const query = nearExpiryQuerySchema.parse({
      withinDays: sp.get("withinDays") ? Number(sp.get("withinDays")) : undefined,
    });
    const rows = await nearExpiry(query);
    return NextResponse.json({ data: rows });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
