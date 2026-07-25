import { NextResponse, type NextRequest } from "next/server";
import { recordGrn, recordGrnSchema } from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// POST /api/grn (both, 🔒S [stock.grn]) — goods-received → stock-in. Stock-moving,
// so idempotent on the Idempotency-Key header (04 §5): a retry with the same key +
// body replays the original GRN instead of double-adding. Zod + requirePermission +
// audit() all live in the core service (one transaction).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const body = await req.json().catch(() => null);
    const input = recordGrnSchema.parse(body);
    const idempotencyKey = req.headers.get("idempotency-key");

    const grn = await recordGrn(input, { session, requestId: rid, idempotencyKey });
    return NextResponse.json(grn, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
