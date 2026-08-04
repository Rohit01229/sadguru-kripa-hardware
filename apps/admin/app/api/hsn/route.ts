import { NextResponse, type NextRequest } from "next/server";
import { searchHsn } from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/hsn?q= (route, 🔒S) — "Find HSN Code": suggest HSN headings (and the GST
// rate that usually goes with them) from a plain item name, so the shopkeeper never
// has to know the code (19 §3). Pure in-memory lookup over a curated hardware list —
// no DB, no upstream call — so it is safe to hit on every keystroke.
//
// Staff-only: it is not secret data, but there is no reason to expose an endpoint
// to anonymous callers. The returned rate is a SUGGESTION the user can overwrite.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json({ data: searchHsn(q) });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
