// Readiness (08 §7): should verify DB connectivity. Wire to a core healthcheck
// that runs `SELECT 1` once the Prisma client is generated (SCAFFOLDING.md).
export function GET(): Response {
  return Response.json({ status: "ok" });
}
