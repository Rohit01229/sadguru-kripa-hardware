import { NextResponse } from "next/server";
import { listCategoryTree } from "@hardware/core";
import { requestId } from "../../../lib/logger";
import { errorResponse } from "../../../lib/http";
import { publicShopId } from "../../../lib/session";

// GET /api/categories (route, 🌐) — full category tree (public → primary shop, 17).
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    return NextResponse.json({ data: await listCategoryTree(await publicShopId()) });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
