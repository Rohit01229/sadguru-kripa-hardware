import { NextResponse, type NextRequest } from "next/server";
import { packOrder } from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";

// POST /api/admin/orders/{id}/pack (action, 🔒S [orders.fulfil]) — CONFIRMED → PACKED.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const { id } = await params;
    const order = await packOrder(id, { session, requestId: rid });
    return NextResponse.json(order);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
