import { NextResponse, type NextRequest } from "next/server";
import { listProducts, createProduct, listProductsQuerySchema, createProductSchema } from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/products (route, 🌐) — list/search; cursor-paginated. Storefront-safe
// projection (the core DTO already omits cost/supplier). `includeArchived` is
// staff-only: stripped unless a staff session is present.
// POST /api/products (both, 🔒S [products.create]) — programmatic create sharing
// the same core service as the create server action.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const sp = req.nextUrl.searchParams;
    const session = await getStaffSession();
    const raw = {
      q: sp.get("q") ?? undefined,
      category: sp.get("category") ?? undefined,
      brand: sp.get("brand") ?? undefined,
      inStock: sp.get("inStock") === "true" ? true : undefined,
      includeArchived: session && sp.get("includeArchived") === "true" ? true : undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    };
    const query = listProductsQuerySchema.parse(raw);
    const page = await listProducts(query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const body = await req.json().catch(() => null);
    const input = createProductSchema.parse(body);
    const product = await createProduct(input, { session, requestId: rid });
    return NextResponse.json(product, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
