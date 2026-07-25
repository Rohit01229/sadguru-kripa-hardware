import { NextResponse, type NextRequest } from "next/server";
import { getProduct, getPublicProduct, updateProduct, updateProductSchema, DomainError } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/products/{id} (route, 🌐) — detail incl. sale units + live stock.
// Staff get the admin detail (cost/reorder/flags); the public gets the safe
// summary and only active products.
// PATCH /api/products/{id} (both, 🔒S [products.update]).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const { id } = await params;
    const session = await getStaffSession();
    const product = session ? await getProduct(id) : await getPublicProduct(id);
    if (!product) throw new DomainError(`Product ${id} not found`, "NOT_FOUND");
    return NextResponse.json(product);
  } catch (e) {
    return errorResponse(e, rid);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const { id } = await params;
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const body = await req.json().catch(() => null);
    const input = updateProductSchema.parse(body);
    const product = await updateProduct(id, input, { session, requestId: rid });
    return NextResponse.json(product);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
