import { NextResponse, type NextRequest } from "next/server";
import { convertKachaToPakka, convertKachaSchema } from "@hardware/core";
import { getStaffSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// POST /api/billing/kacha/convert (both, 🔒S [bill.pakka.create]) — convert the
// in-memory kacha cart → a saved pakka tax invoice (04 §8.4). Never an upgrade of a
// committed kacha; submits the cart to the pakka-create path. If stock was already
// decremented (stockAlreadyDecremented), attributes the existing KACHA_OUT movements
// instead of double-deducting. Idempotent on the Idempotency-Key (04 §5).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const body = await req.json().catch(() => null);
    const input = convertKachaSchema.parse(body);
    const idempotencyKey = req.headers.get("idempotency-key");
    const invoice = await convertKachaToPakka(input, { session, requestId: rid, idempotencyKey });
    return NextResponse.json(invoice, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
