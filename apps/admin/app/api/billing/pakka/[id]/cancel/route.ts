import { NextResponse, type NextRequest } from "next/server";
import { cancelInvoice, cancelInvoiceSchema } from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";

// POST /api/billing/pakka/{id}/cancel (action, 🔒S [bill.cancel] — OWNER-ONLY) —
// cancel a pakka invoice: status → CANCELLED (no delete, gapless preserved), reverse
// stock + ledger, void log. Reason required. requirePermission(bill.cancel) + audit
// run in core (one transaction). 422 on an already-cancelled invoice.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const input = cancelInvoiceSchema.parse(body);
    const invoice = await cancelInvoice(id, input, { session, requestId: rid });
    return NextResponse.json(invoice);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
