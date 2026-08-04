import { NextResponse, type NextRequest } from "next/server";
import { importCatalog, DomainError } from "@hardware/core";
import { getStaffSession } from "../../../../lib/session";
import { requestId } from "../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../lib/http";

// POST /api/import/catalog (route, multipart, 🔒S [import.catalog]) — upload a
// CSV of catalog + opening stock. Returns 202 + jobId. Poll
// GET /api/import/jobs/{id} for row-level errors.
//
// DEVIATION (flagged in the report): the async QStash queue lands in S7, so S2
// processes the import SYNCHRONOUSLY inside the request before returning 202. The
// API contract (202 + jobId + pollable job) is already correct; only the
// execution mode changes when S7 wires the queue.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return errorResponse(new DomainError("A CSV or Excel file is required", "FK_VIOLATION"), rid);
    }
    // Hand the raw bytes over: the service sniffs .xlsx (a ZIP) vs text CSV itself, so a
    // mislabelled or extension-less upload still imports (19 §9).
    const bytes = new Uint8Array(await file.arrayBuffer());

    const job = await importCatalog(bytes, { session, requestId: rid });
    return NextResponse.json(
      { jobId: job.id, status: job.status, totalRows: job.totalRows, createdRows: job.createdRows, errorRows: job.errorRows },
      { status: 202 },
    );
  } catch (e) {
    return errorResponse(e, rid);
  }
}
