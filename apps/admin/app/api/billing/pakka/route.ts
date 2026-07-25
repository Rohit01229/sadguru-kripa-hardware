import { NextResponse, type NextRequest } from "next/server";
import {
  finalizePakka,
  listInvoices,
  requirePermission,
  finalizePakkaSchema,
  listInvoicesQuerySchema,
} from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// POST /api/billing/pakka (both, 🔒S [bill.pakka.create]) — create a saved GST tax
// invoice: GSTIN, HSN per line, CGST/SGST or IGST by place-of-supply, gapless number,
// manual rate override, line/bill discount, round-off, payment mode. Idempotent on
// the Idempotency-Key (04 §5). Zod + requirePermission + audit() live in the core
// service (one transaction).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const body = await req.json().catch(() => null);
    const input = finalizePakkaSchema.parse(body);
    const idempotencyKey = req.headers.get("idempotency-key");
    const invoice = await finalizePakka(input, { session, requestId: rid, idempotencyKey });
    return NextResponse.json(invoice, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}

// GET /api/billing/pakka (route, 🔒S [bill.read]) — list invoices; from/to,
// paymentMode, customerId. Cursor-paginated (newest first).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "bill.read");

    const sp = req.nextUrl.searchParams;
    const query = listInvoicesQuerySchema.parse({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      customerId: sp.get("customerId") ?? undefined,
      paymentMode: sp.get("paymentMode") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
    const page = await listInvoices(query);
    return NextResponse.json(page);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
