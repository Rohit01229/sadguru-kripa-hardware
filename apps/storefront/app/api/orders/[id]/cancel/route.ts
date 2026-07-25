import { NextResponse, type NextRequest } from "next/server";
import { cancelOrder, cancelOrderSchema } from "@hardware/core";
import { getCustomerSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// POST /api/orders/{id}/cancel (action, 🔒C [orders.cancel.own]) — cancel before
// dispatch → releases the reservation (04 §8). OWNERSHIP-scoped: the order must
// belong to the session's customer, else 404. Zod + requirePermission + audit in core.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = cancelOrderSchema.parse(body ?? {});
    const order = await cancelOrder(id, input, { session, requestId: rid });
    return NextResponse.json(order);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
