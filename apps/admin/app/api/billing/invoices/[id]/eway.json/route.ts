import { NextResponse, type NextRequest } from "next/server";
import { buildEwayBillPayload, requireShop, requirePermission } from "@hardware/core";
import { getStaffSession } from "../../../../../../lib/session";
import { requestId } from "../../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../../lib/http";

// GET /api/billing/invoices/{id}/eway.json (🔒S [bill.read]) — the e-way bill portal's
// own upload format (doc 20 §7).
//
// We have no GSP credentials, so instead of pretending to integrate we hand the
// shopkeeper a file the portal accepts verbatim: they upload it at ewaybillgst.gov.in
// rather than re-typing the consignment. Field names are the portal's, not ours.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "bill.read");
    const shopId = requireShop(session);

    const { id } = await params;
    const payload = await buildEwayBillPayload(shopId, id);

    // The portal's bulk upload takes an ARRAY of consignments.
    const body = JSON.stringify([payload], null, 2);
    const safeNo = String(payload.docNo ?? id).replace(/[^\w.-]+/g, "_");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ewaybill-${safeNo}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
