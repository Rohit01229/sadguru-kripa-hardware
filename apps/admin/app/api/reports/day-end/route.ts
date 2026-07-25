import { NextResponse, type NextRequest } from "next/server";
import { dayEnd, requirePermission, dayEndQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/reports/day-end (route, 🔒S [reports.read]) — single-day pakka roll-up
// (kacha excluded by design). Cancelled invoices counted, not summed. Read-only.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "reports.read");

    const sp = req.nextUrl.searchParams;
    const query = dayEndQuerySchema.parse({ date: sp.get("date") ?? undefined });
    const report = await dayEnd(query);
    return NextResponse.json(report);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
