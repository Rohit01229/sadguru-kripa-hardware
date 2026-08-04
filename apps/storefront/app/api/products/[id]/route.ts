import { NextResponse, type NextRequest } from "next/server";
import { getPublicProduct, DomainError } from "@hardware/core";
import { requestId } from "../../../../lib/logger";
import { errorResponse } from "../../../../lib/http";
import { storefrontShopId } from "../../../../lib/session";

// GET /api/products/{id} (route, 🌐) — public detail incl. sale units + live stock.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const { id } = await params;
    const shopId = await storefrontShopId();
    const product = await getPublicProduct(shopId, id);
    if (!product) throw new DomainError(`Product ${id} not found`, "NOT_FOUND");
    return NextResponse.json(product);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
