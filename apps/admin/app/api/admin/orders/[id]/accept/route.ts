import { NextResponse, type NextRequest } from "next/server";
import { acceptOrder } from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";

// POST /api/admin/orders/{id}/accept (action, 🔒S [orders.fulfil]) — owner confirms →
// CONFIRMED. requirePermission + audit live in the core service (one tx).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const { id } = await params;
    const order = await acceptOrder(id, { session, requestId: rid });
    return NextResponse.json(order);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
