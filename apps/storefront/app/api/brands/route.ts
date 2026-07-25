import { NextResponse } from "next/server";
import { listBrands } from "@hardware/core";
import { requestId } from "../../../lib/logger";
import { errorResponse } from "../../../lib/http";

// GET /api/brands (route, 🌐) — public brand list (id + name) for the catalog brand
// filter. Mirrors /api/categories.
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    return NextResponse.json({ data: await listBrands() });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
