import { NextResponse, type NextRequest } from "next/server";
import { getProfile, addAddress, upsertAddressSchema } from "@hardware/core";
import { getCustomerSession, storefrontShopId } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/account/addresses (🔒C) — the customer's own addresses.
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const shopId = await storefrontShopId();
    const profile = await getProfile(shopId, session.customerId);
    return NextResponse.json(profile?.addresses ?? []);
  } catch (e) {
    return errorResponse(e, rid);
  }
}

// POST /api/account/addresses (action, 🔒C) — add an address (own party). First
// address becomes the default; state drives place-of-supply (03 §8).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const shopId = await storefrontShopId();
    const body = await req.json().catch(() => null);
    const input = upsertAddressSchema.parse(body);
    const address = await addAddress(shopId, session.customerId, input);
    return NextResponse.json(address, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
