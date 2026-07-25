import { NextResponse, type NextRequest } from "next/server";
import { listOrdersAdmin, requirePermission, listOrdersQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/admin/orders (route, 🔒S [orders.read]) — the fulfilment queue; filter by
// status. Cursor-paginated (newest first).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "orders.read");
    const sp = req.nextUrl.searchParams;
    const query = listOrdersQuerySchema.parse({
      status: sp.get("status") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    const page = await listOrdersAdmin(query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
