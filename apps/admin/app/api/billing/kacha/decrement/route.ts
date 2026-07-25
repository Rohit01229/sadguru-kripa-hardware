import { NextResponse, type NextRequest } from "next/server";
import { finalizeKacha, kachaDecrementSchema } from "@hardware/core";
import { getStaffSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// POST /api/billing/kacha/decrement (action, 🔒S [bill.kacha.create]) — ZERO TRACE.
// Validates lines, applies UoM conversion, decrements stock ONLY (one KACHA_OUT
// movement per line). Persists NO bill, value, cash, customer, or tax (03 §6). Returns
// an EPHEMERAL estimate ({ estimate, stockMovementRefs }) — no invoiceNo, no bill row.
// NOT idempotent in the bill sense (04 §5): nothing is persisted to dedupe against.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const body = await req.json().catch(() => null);
    const input = kachaDecrementSchema.parse(body);
    const estimate = await finalizeKacha(input, { session, requestId: rid });
    // 200 (not 201): nothing was created — this is an ephemeral estimate.
    return NextResponse.json({ estimate, stockMovementRefs: estimate.stockMovementRefs }, { status: 200 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
