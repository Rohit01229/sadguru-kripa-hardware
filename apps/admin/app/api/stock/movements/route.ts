import { NextResponse, type NextRequest } from "next/server";
import { listMovements, requirePermission, movementsQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/stock/movements (route, 🔒S [stock.read]) — the movement ledger. All
// kinds incl. KACHA_OUT (shown as an unattributed stock-out — 03 §6). Filter by
// productId / date range; cursor-paginated (newest first).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "stock.read");

    const sp = req.nextUrl.searchParams;
    const query = movementsQuerySchema.parse({
      productId: sp.get("productId") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    const page = await listMovements(query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
