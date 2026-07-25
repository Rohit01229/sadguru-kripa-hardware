import { NextResponse, type NextRequest } from "next/server";
import { listProducts, listProductsQuerySchema } from "@hardware/core";
import { requestId } from "../../../lib/logger";
import { errorResponse } from "../../../lib/http";

// GET /api/products (route, 🌐) — public storefront list/search + filtering. All
// filtering/sort is server-side (URL params -> core query -> SQL). Storefront-safe
// projection; archived products never appear (no includeArchived here). Filter params
// are additive + optional — omitting one keeps the prior behaviour.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const sp = req.nextUrl.searchParams;
    const numParam = (key: string): number | undefined => {
      const raw = sp.get(key);
      if (raw === null || raw.trim() === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const query = listProductsQuerySchema.parse({
      q: sp.get("q") ?? undefined,
      category: sp.get("category") ?? undefined,
      brand: sp.get("brand") ?? undefined,
      categoryId: sp.get("categoryId") ?? undefined,
      brandId: sp.get("brandId") ?? undefined,
      priceMinPaise: numParam("priceMinPaise"),
      priceMaxPaise: numParam("priceMaxPaise"),
      inStock: sp.get("inStock") === "true" ? true : undefined,
      inStockOnly: sp.get("inStockOnly") === "true" || sp.get("inStockOnly") === "1" ? true : undefined,
      sort: sp.get("sort") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    return NextResponse.json(await listProducts(query));
  } catch (e) {
    return errorResponse(e, rid);
  }
}
