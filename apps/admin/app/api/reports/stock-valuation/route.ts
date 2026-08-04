import { NextResponse, type NextRequest } from "next/server";
import { stockValuation, requireShop, requirePermission, stockValuationQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/reports/stock-valuation (route, 🔒S [reports.read]) — on-hand × cost per
// base unit across the active catalog. Read-only.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "reports.read");
    const shopId = requireShop(session);

    const sp = req.nextUrl.searchParams;
    const query = stockValuationQuerySchema.parse({ inStockOnly: sp.get("inStockOnly") ?? undefined });
    const report = await stockValuation(shopId, query);
    return NextResponse.json(report);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
