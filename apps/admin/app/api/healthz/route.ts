// Liveness (08 §7): process is up. No auth, no PII, cheap.
export function GET(): Response {
  return Response.json({ status: "ok" });
}
