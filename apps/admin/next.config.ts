import path from "path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl: locale resolved from the NEXT_LOCALE cookie (no `[locale]` URL segment).
// The request config merges the namespaced message files for the active locale.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Security headers + CSP (07 §8). Cloudinary image uploads (api.cloudinary.com) are
// allow-listed for connect-src; product images load under img-src https:.
// Next.js dev (Fast Refresh / HMR) evaluates modules via eval() and opens a websocket,
// so 'unsafe-eval' + ws:/wss: are required in DEVELOPMENT ONLY. Production stays locked
// down (no eval). Without the dev exception the client bundle throws a CSP EvalError and
// the whole app fails to hydrate — every link becomes a full reload and buttons are dead.
const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // img-src allows any https: so Cloudinary product images (res.cloudinary.com) load.
      "img-src 'self' data: blob: https:",
      // Browser uploads product photos directly to the Cloudinary upload API.
      `connect-src 'self' https://api.cloudinary.com${isDev ? " ws: wss:" : ""}`,
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages must be transpiled by Next (monorepo requirement).
  transpilePackages: ["@hardware/core", "@hardware/auth", "@hardware/ui"],
  // Prisma on Vercel + pnpm monorepo: Next's file tracer misses the dynamically-loaded
  // query-engine .so, so the deployed function throws "could not locate the Query Engine
  // for runtime rhel-openssl-3.0.x". Trace from the repo root and explicitly copy the
  // generated engine into the bundle. Pairs with schema.prisma binaryTargets.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/**/*": ["../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
