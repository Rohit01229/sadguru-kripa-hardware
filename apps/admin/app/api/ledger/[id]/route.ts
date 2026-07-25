import { NextResponse, type NextRequest } from "next/server";
import { getStatement, aging, requirePermission } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/ledger/{customerId} (route, 🔒S [ledger.read]) — outstanding, statement,
// and aging buckets (0-30 / 31-60 / 60+) for a counter customer.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "ledger.read");

    const { id } = await params;
    // Additive statement window (server-side; URL params: from / to, ISO dates).
    const sp = req.nextUrl.searchParams;
    const stmtQuery = { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined };
    const [statement, agingBuckets] = await Promise.all([getStatement(id, stmtQuery), aging(id)]);
    return NextResponse.json({ ...statement, aging: agingBuckets });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
