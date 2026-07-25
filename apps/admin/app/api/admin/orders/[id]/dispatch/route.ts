import { NextResponse, type NextRequest } from "next/server";
import { dispatchOrder, dispatchOrderSchema } from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";
import { queueOrderStatusEmail } from "../../../../../../lib/notify";

// POST /api/admin/orders/{id}/dispatch (both, 🔒S [orders.fulfil]) — DISPATCHED:
// final stock deduction (converts the reservation) + generates the pakka invoice at
// hand-over (pakka-on-dispatch; IGST if inter-state). One core transaction. Queues
// the dispatch + invoice email (runtime-deferred if RESEND_API_KEY is empty).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = dispatchOrderSchema.parse(body ?? {});
    const { order, invoice } = await dispatchOrder(id, input, { session, requestId: rid });
    await queueOrderStatusEmail({ orderId: order.id, status: "DISPATCHED", invoiceNo: invoice.invoiceNo });
    return NextResponse.json({ order, invoice });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
