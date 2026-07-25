import { NextResponse, type NextRequest } from "next/server";
import { deleteAddress } from "@hardware/core";
import { getCustomerSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// DELETE /api/account/addresses/{id} (action, 🔒C) — remove an own address
// (ownership-scoped: the address must belong to the session's customer, else 404).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getCustomerSession();
    if (!session || !session.customerId) return unauthenticated(rid);
    const { id } = await params;
    await deleteAddress(session.customerId, id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
