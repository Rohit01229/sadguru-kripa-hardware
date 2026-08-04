import { NextResponse } from "next/server";
import { listUnits, requireShop } from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/units (route, 🔒S) — master unit list (base + sale unit defs).
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const shopId = requireShop(session);
    return NextResponse.json({ data: await listUnits(shopId) });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
