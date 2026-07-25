import { NextResponse, type NextRequest } from "next/server";
import { gstr1, gstr1Csv, requirePermission, gstr1QuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/reports/gstr1?period=YYYY-MM[&format=csv] (route, 🔒S [reports.export]) —
// GSTR-1 export: B2B / B2C / credit-note sections + HSN summary. JSON (default) or CSV
// download. Figures reconcile to the period's ACTIVE invoices; kacha absent (no rows);
// an empty period returns empty sections (never fabricated). Read-only.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "reports.export");

    const sp = req.nextUrl.searchParams;
    const query = gstr1QuerySchema.parse({
      period: sp.get("period") ?? undefined,
      format: sp.get("format") ?? undefined,
    });

    if (query.format === "csv") {
      const csv = await gstr1Csv(query);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="gstr1-${query.period}.csv"`,
        },
      });
    }

    const report = await gstr1(query);
    return NextResponse.json(report);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
