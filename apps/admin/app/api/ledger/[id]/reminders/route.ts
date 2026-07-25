import { NextResponse, type NextRequest } from "next/server";
import { triggerReminder, triggerReminderSchema } from "@hardware/core";
import { getStaffSession } from "../../../../../lib/session";
import { requestId } from "../../../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../../../lib/http";

// POST /api/ledger/{customerId}/reminders (action, 🔒S [ledger.write]) — trigger a
// dues reminder. In S5 this recomputes the outstanding and queues a reminder (the
// QStash enqueue + Resend/MSG91 send is wired in S7). No-op when nothing is owed.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = triggerReminderSchema.parse(body ?? {});
    const result = await triggerReminder(id, input, { session, requestId: rid });
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    return errorResponse(e, rid);
  }
}
