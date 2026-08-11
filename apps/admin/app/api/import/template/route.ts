import { NextResponse } from "next/server";
import { buildImportTemplateCsv } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// GET /api/import/template (route, 🔒S) — download a ready-to-fill catalog template
// (19 §9). Handing the shopkeeper a file that already has the right headings and two
// worked example rows beats documenting column names and hoping they match.
//
// CSV rather than .xlsx: Excel opens it natively, it round-trips through Google Sheets
// and Tally, and generating a real .xlsx would mean writing a ZIP for no user benefit
// (the importer reads both).
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    // A leading BOM makes Excel honour UTF-8 (₹ and Hindi text) on a double-click open.
    // Written as an escape, not a literal U+FEFF: the raw character is invisible in an
    // editor, so anyone tidying this line would delete it without noticing.
    const body = `\uFEFF${buildImportTemplateCsv()}`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="item-import-template.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
