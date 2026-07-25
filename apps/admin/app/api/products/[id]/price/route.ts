import { NextResponse, type NextRequest } from "next/server";
import { resolvePrice, resolvePriceQuerySchema } from "@hardware/core";
import { requestId } from "../../../../../lib/logger";
import { errorResponse } from "../../../../../lib/http";

// GET /api/products/{id}/price?qty=&unitId= (route, 🌐) — resolve the effective
// per-sale-unit price for a quantity, applying bulk slabs (visible to all,
// 02 Decision 5). Money returned as integer paise (04 §2).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const { id } = await params;
    const sp = req.nextUrl.searchParams;
    const query = resolvePriceQuerySchema.parse({
      // accept `unitId` (per 04 path) or `saleUnitId`
      saleUnitId: sp.get("unitId") ?? sp.get("saleUnitId") ?? undefined,
      qty: sp.get("qty") ?? undefined,
    });
    const resolved = await resolvePrice(id, query);
    return NextResponse.json(resolved);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
