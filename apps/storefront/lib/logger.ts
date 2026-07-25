import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { createLogger, redact } from "@hardware/core";

// Server logger for the storefront: reuses the tested core logger (JSON + redact)
// and stamps every line with a correlation id (requestId).

export async function requestId(): Promise<string> {
  const h = await headers();
  return h.get("x-request-id") ?? h.get("x-correlation-id") ?? randomUUID();
}

export async function serverLogger() {
  return createLogger({ app: "storefront", requestId: await requestId() });
}

export { redact };
