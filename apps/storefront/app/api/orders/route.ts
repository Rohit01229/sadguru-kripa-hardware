import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { placeOrder, listMyOrders, placeOrderSchema, listOrdersQuerySchema } from "@hardware/core";
import { createAuthLimiter, checkLimit } from "@hardware/auth";
import { getCustomerSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// Per-customer placement limiter (ratelimit-3): placeOrder() atomically reserves
// stock with a TTL, so an authed+verified customer could spam distinct orders to
// grief inventory / mint unbounded gateway orders. Keyed by authenticated
// customerId (post-auth), not IP. Fail-open when Upstash is absent (dev).
const placeLimiter = createAuthLimiter("orders:place:cust", 20, "1 m");

// POST /api/orders (both, 🔒C [orders.place]) — place an order → atomically RESERVES
// stock with a TTL (04 §8.5). 409 STOCK_INSUFFICIENT on reserve fail. Idempotent on
// the Idempotency-Key (04 §5). Zod + requirePermission + audit live in the core
// service (one transaction).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    if (!(await checkLimit(placeLimiter, `cust:${session.customerId}`)).success) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many orders, slow down.", requestId: rid } },
        { status: 429 },
      );
    }
    const body = await req.json().catch(() => null);
    const input = placeOrderSchema.parse(body);
    const idempotencyKey = req.headers.get("idempotency-key") ?? randomUUID();
    const order = await placeOrder(input, { session, requestId: rid, idempotencyKey });
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}

// GET /api/orders (route, 🔒C) — customer order history (OWNERSHIP-scoped to the
// session's customer party). Cursor-paginated; filter by status + createdAt date range
// (from/to additive — omit a bound to leave it open). Filtering is server-side (params
// -> listMyOrders -> SQL).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const sp = req.nextUrl.searchParams;
    const query = listOrdersQuerySchema.parse({
      status: sp.get("status") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    const page = await listMyOrders(session.customerId, query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
