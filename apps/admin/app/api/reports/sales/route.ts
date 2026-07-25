import { NextResponse, type NextRequest } from "next/server";
import { salesReport, requirePermission, salesReportQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/reports/sales (route, 🔒S [reports.read]) — sales by day/item/category/
// payment-mode over [from,to]. ACTIVE pakka only; kacha excluded (no rows). Read-only.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "reports.read");

    const sp = req.nextUrl.searchParams;
    const query = salesReportQuerySchema.parse({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      groupBy: sp.get("groupBy") ?? undefined,
    });
    const report = await salesReport(query);
    return NextResponse.json(report);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
