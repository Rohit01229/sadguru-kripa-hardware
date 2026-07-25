import { NextResponse, type NextRequest } from "next/server";
import { recordPayment, recordPaymentSchema } from "@hardware/core";
import { getStaffSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// POST /api/ledger/{customerId}/payments (both, 🔒S [ledger.write]) — record a khata
// receipt (part-payment) against outstanding. Idempotent on the Idempotency-Key
// (04 §5). Zod + requirePermission + audit live in core (one transaction).
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
    const input = recordPaymentSchema.parse(body);
    const idempotencyKey = req.headers.get("idempotency-key");
    const receipt = await recordPayment(id, input, { session, requestId: rid, idempotencyKey });
    return NextResponse.json(receipt, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
