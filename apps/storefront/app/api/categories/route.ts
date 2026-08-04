import { NextResponse } from "next/server";
import { listCategoryTree } from "@hardware/core";
import { requestId } from "../../../lib/logger";
import { errorResponse } from "../../../lib/http";
import { storefrontShopId } from "../../../lib/session";

// GET /api/categories (route, 🌐) — public category tree.
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const shopId = await storefrontShopId();
    return NextResponse.json({ data: await listCategoryTree(shopId) });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
