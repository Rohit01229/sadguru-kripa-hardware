import { NextResponse, type NextRequest } from "next/server";
import { getInvoice, requirePermission, DomainError } from "@hardware/core";
import { getStaffSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// GET /api/billing/pakka/{id} (route, 🔒S [bill.read]) — invoice detail for reprint
// (A4/A5/thermal). 404 when the invoice does not exist.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "bill.read");

    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) throw new DomainError(`Invoice ${id} not found`, "NOT_FOUND");
    return NextResponse.json(invoice);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
