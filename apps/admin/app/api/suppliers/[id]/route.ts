import { NextResponse, type NextRequest } from "next/server";
import { editSupplier, getSupplier, requirePermission, editSupplierSchema } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/suppliers/{id} (route, 🔒S [suppliers.read]) — detail.
// PATCH /api/suppliers/{id} (action/both, 🔒S [suppliers.write]) — edit.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "suppliers.read");
    const { id } = await params;
    const supplier = await getSupplier(id);
    if (!supplier) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Supplier not found.", requestId: rid } }, { status: 404 });
    }
    return NextResponse.json(supplier);
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
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const input = editSupplierSchema.parse(body);
    const supplier = await editSupplier(id, input, { session, requestId: rid });
    return NextResponse.json(supplier);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
