import { NextResponse, type NextRequest } from "next/server";
import { getProfile, updateProfile, updateProfileSchema } from "@hardware/core";
import { getCustomerSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/account/profile (🔒C) — the customer's own profile + addresses.
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const profile = await getProfile(session.customerId);
    if (!profile) return unauthenticated(rid);
    return NextResponse.json(profile);
  } catch (e) {
    return errorResponse(e, rid);
  }
}

// PATCH /api/account/profile (action, 🔒C) — update name/phone/GSTIN (own party).
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const body = await req.json().catch(() => null);
    const input = updateProfileSchema.parse(body);
    const profile = await updateProfile(session.customerId, input);
    return NextResponse.json(profile);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
