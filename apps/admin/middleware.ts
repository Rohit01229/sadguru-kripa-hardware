import { NextResponse, type NextRequest } from "next/server";

// Coarse gate only (10 §5): require a staff session cookie for admin pages. The
// authoritative permission check runs server-side in @hardware/core. A customer
// session uses a DIFFERENT cookie name (hw.customer.session), so it can never
// satisfy this check — realm separation (10 §2.3). API routes return their own
// JSON status codes, so they are not redirected here.
//
// Runs in the Edge runtime — must NOT import @hardware/auth (it pulls in the
// Prisma client). The cookie name is the stable constant `STAFF_COOKIE`.
const STAFF_COOKIE = "hw.staff.session";

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(STAFF_COOKIE);
  const isAuthRoute = pathname.startsWith("/login");
  const isApi = pathname.startsWith("/api");
  if (!hasSession && !isAuthRoute && !isApi) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Exclude health checks, Next internals, and the public PWA assets (manifest, service
  // worker, icons, offline page) so they are reachable without a staff session — the
  // login page must be installable and the SW must register while signed out.
  matcher: [
    "/((?!api/healthz|api/readyz|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|offline.html).*)",
  ],
};
