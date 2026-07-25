import { NextResponse } from "next/server";
import { listCategoryTree } from "@hardware/core";
import { requestId } from "../../../lib/logger";
import { errorResponse } from "../../../lib/http";

// GET /api/categories (route, 🌐) — public category tree.
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    return NextResponse.json({ data: await listCategoryTree() });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
