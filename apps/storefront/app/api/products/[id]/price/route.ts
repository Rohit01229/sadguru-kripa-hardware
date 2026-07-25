import { NextResponse, type NextRequest } from "next/server";
import { resolvePrice, resolvePriceQuerySchema } from "@hardware/core";
import { requestId } from "../../../../../lib/logger";
import { errorResponse } from "../../../../../lib/http";

// GET /api/products/{id}/price?qty=&unitId= (route, 🌐) — public bulk-slab price.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const { id } = await params;
    const sp = req.nextUrl.searchParams;
    const query = resolvePriceQuerySchema.parse({
      saleUnitId: sp.get("unitId") ?? sp.get("saleUnitId") ?? undefined,
      qty: sp.get("qty") ?? undefined,
    });
    return NextResponse.json(await resolvePrice(id, query));
  } catch (e) {
    return errorResponse(e, rid);
  }
}
