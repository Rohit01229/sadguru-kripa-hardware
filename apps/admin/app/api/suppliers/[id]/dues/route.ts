import { NextResponse, type NextRequest } from "next/server";
import { getSupplierDues, requirePermission } from "@hardware/core";
import { getStaffSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// GET /api/suppliers/{id}/dues (route, 🔒S [suppliers.read]) — recorded supplier
// payments ([N], nice-to-have). POs are future, so no payable is computed yet.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "suppliers.read");
    const { id } = await params;
    const dues = await getSupplierDues(id);
    return NextResponse.json(dues);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
