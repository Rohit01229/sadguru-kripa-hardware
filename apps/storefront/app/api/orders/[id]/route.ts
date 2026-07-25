import { NextResponse, type NextRequest } from "next/server";
import { getMyOrder } from "@hardware/core";
import { getCustomerSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/orders/{id} (route, 🔒C) — a single order with status + items. OWNERSHIP:
// a customer fetching someone else's order gets 404 (the read is scoped by
// session.customerId — 10 §5).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const { id } = await params;
    const order = await getMyOrder(session.customerId, id);
    if (!order) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Order not found.", requestId: rid } },
        { status: 404 },
      );
    }
    return NextResponse.json(order);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
