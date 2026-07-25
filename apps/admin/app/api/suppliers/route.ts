import { NextResponse, type NextRequest } from "next/server";
import { listSuppliers, createSupplier, requirePermission, upsertSupplierSchema } from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/suppliers (route, 🔒S [suppliers.read]) — supplier directory.
// POST /api/suppliers (both, 🔒S [suppliers.write]) — create, sharing the core
// service with the create server action.
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "suppliers.read");
    const data = await listSuppliers();
    return NextResponse.json({ data });
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
    const input = upsertSupplierSchema.parse(body);
    const supplier = await createSupplier(input, { session, requestId: rid });
    return NextResponse.json(supplier, { status: 201 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
