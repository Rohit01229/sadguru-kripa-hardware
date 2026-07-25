import { NextResponse } from "next/server";
import { getStaffSession } from "../../../lib/session";

// GET /api/me (04 §6) — current staff principal + resolved permissions, or 401.
export async function GET(): Promise<NextResponse> {
  const session = await getStaffSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  return NextResponse.json({
    userId: session.userId,
    realm: session.realm,
    roles: session.roles ?? [],
    permissions: session.permissions,
  });
}
