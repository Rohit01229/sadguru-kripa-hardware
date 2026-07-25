import { NextResponse, type NextRequest } from "next/server";
import { getImportJob, DomainError } from "@hardware/core";
import { getStaffSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// GET /api/import/jobs/{jobId} (route, 🔒S [import.catalog]) — import status +
// row-level errors. Job state is in-process in S2 (durable in S7).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const { jobId } = await params;
    const job = getImportJob(jobId);
    if (!job) throw new DomainError(`Import job ${jobId} not found`, "NOT_FOUND");
    return NextResponse.json(job);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
