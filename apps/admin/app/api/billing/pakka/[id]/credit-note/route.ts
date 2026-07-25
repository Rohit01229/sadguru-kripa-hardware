import { NextResponse, type NextRequest } from "next/server";
import {
  createCreditNote,
  listCreditNotesForInvoice,
  createCreditNoteSchema,
  requirePermission,
} from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";

// POST /api/billing/pakka/{id}/credit-note (both, 🔒S [bill.creditnote.create]) —
// credit note vs the original invoice: own gapless CN series, partial returns,
// refund mode (cash/UPI/khata-adjust/gateway), reverses stock via SALES_RETURN_IN.
// Idempotent on the Idempotency-Key (04 §5). Zod + requirePermission + audit in core.
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
    const input = createCreditNoteSchema.parse(body);
    const idempotencyKey = req.headers.get("idempotency-key");
    const cn = await createCreditNote(id, input, { session, requestId: rid, idempotencyKey });
    return NextResponse.json(cn, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}

// GET /api/billing/pakka/{id}/credit-note (route, 🔒S [bill.read]) — list credit
// notes issued against this invoice (for reprint / audit).
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
    const notes = await listCreditNotesForInvoice(id);
    return NextResponse.json({ data: notes });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
