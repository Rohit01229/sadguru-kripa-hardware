import { NextResponse, type NextRequest } from "next/server";
import {
  getFullStoreConfig,
  updateStoreConfig,
  requirePermission,
  updateStoreConfigSchema,
  DomainError,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { errorResponse, unauthenticated } from "../../../lib/http";

// GET /api/settings (route, 🔒S [settings.read]) — full StoreConfig (13 §10). 404 when
// the store has not been seeded.
export async function GET(): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    requirePermission(session, "settings.read");
    const config = await getFullStoreConfig();
    if (!config) throw new DomainError("StoreConfig not initialised", "NOT_FOUND");
    return NextResponse.json(config);
  } catch (e) {
    return errorResponse(e, rid);
  }
}

// PATCH /api/settings (route, 🔒S [settings.write]) — partial-patch the store config.
// Zod + requirePermission + audit() live in the core service (one transaction).
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const rid = await requestId();
  try {
    const session = await getStaffSession();
    if (!session) return unauthenticated(rid);
    const body = await req.json().catch(() => null);
    const input = updateStoreConfigSchema.parse(body);
    const config = await updateStoreConfig(input, { session, requestId: rid });
    return NextResponse.json(config);
  } catch (e) {
    return errorResponse(e, rid);
  }
}
