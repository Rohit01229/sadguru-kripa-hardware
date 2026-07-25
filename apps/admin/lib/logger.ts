import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { createLogger, redact } from "@hardware/core";

// Server logger for the admin app: reuses the tested core logger (JSON + redact,
// 08 §1) and stamps every line with a correlation id (requestId) so a request can
// be traced across services (14-impl-plan Chunk 5 §4).

/** Correlation id for the current request: honour an inbound header or mint one. */
export async function requestId(): Promise<string> {
  const h = await headers();
  return h.get("x-request-id") ?? h.get("x-correlation-id") ?? randomUUID();
}

/** A request-scoped logger child carrying the app name + correlation id. */
export async function serverLogger() {
  return createLogger({ app: "admin", requestId: await requestId() });
}

export { redact };
