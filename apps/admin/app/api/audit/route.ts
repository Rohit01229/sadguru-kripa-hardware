import { NextResponse, type NextRequest } from "next/server";
import { listAudit, requirePermission, auditQuerySchema } from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/audit (route, 🔒S [audit.read]) — browse the append-only AuditLog (10 §7).
// Filter by action/target/actor/date range; cursor-paginated (newest first). The log
// is never edited or deleted; this is a read-only view. Read-only.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "audit.read");

    const sp = req.nextUrl.searchParams;
    const query = auditQuerySchema.parse({
      action: sp.get("action") ?? undefined,
      targetType: sp.get("targetType") ?? undefined,
      targetId: sp.get("targetId") ?? undefined,
      actorStaffId: sp.get("actorStaffId") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    const page = await listAudit(query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
