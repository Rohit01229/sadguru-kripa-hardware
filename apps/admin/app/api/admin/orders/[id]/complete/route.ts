import { NextResponse, type NextRequest } from "next/server";
import { completeOrder } from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";

// POST /api/admin/orders/{id}/complete (action, 🔒S [orders.fulfil]) — DISPATCHED →
// COMPLETED (delivered / handed over).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const { id } = await params;
    const order = await completeOrder(id, { session, requestId: rid });
    return NextResponse.json(order);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
