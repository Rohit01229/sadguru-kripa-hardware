import { NextResponse, type NextRequest } from "next/server";
import {
  listCustomers,
  createCustomer,
  requirePermission,
  listCustomersQuerySchema,
  upsertCustomerSchema,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/customers (route, 🔒S [customers.read]) — counter-customer directory
// (distinct from storefront accounts). Cursor-paginated; q matches name/phone/gstin.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "customers.read");

    const sp = req.nextUrl.searchParams;
    const query = listCustomersQuerySchema.parse({
      q: sp.get("q") ?? undefined,
      // Additive filters (server-side; URL params: hasOutstanding=1, agingBucket=...).
      hasOutstanding: sp.get("hasOutstanding") === "1" ? true : undefined,
      agingBucket: sp.get("agingBucket") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    const page = await listCustomers(query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}

// POST /api/customers (action/route, 🔒S [customers.write]) — create a counter
// customer (name/phone/GSTIN/type). Zod + requirePermission + audit in core.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const body = await req.json().catch(() => null);
    const input = upsertCustomerSchema.parse(body);
    const customer = await createCustomer(input, { session, requestId: rid });
    return NextResponse.json(customer, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
