import { NextResponse, type NextRequest } from "next/server";
import { listStock, requirePermission, stockListQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/stock (route, 🔒S [stock.read]) — on-hand per product (base unit) with a
// low-stock flag. Cursor-paginated. `q` (name/sku), `lowOnly`. The guard is the
// gate (10 §5) — UI hiding is cosmetic.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "stock.read");

    const sp = req.nextUrl.searchParams;
    const query = stockListQuerySchema.parse({
      q: sp.get("q") ?? undefined,
      lowOnly: sp.get("lowOnly") === "true" ? true : undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    const page = await listStock(query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
