import { NextResponse, type NextRequest } from "next/server";
import { priceCart, priceCartSchema } from "@hardware/core";
import { getCustomerSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// POST /api/cart (🔒C) — price a cart for the checkout summary WITHOUT reserving.
// The cart itself is client/session-held (04 Orders); this returns item total +
// delivery fee + place-of-supply tax-kind preview + live availability per line. The
// authoritative reserve + total happen atomically in POST /api/orders.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const body = await req.json().catch(() => null);
    const input = priceCartSchema.parse(body);
    const summary = await priceCart(session.customerId, input);
    return NextResponse.json(summary);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
