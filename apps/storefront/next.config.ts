import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl: locale resolved from the NEXT_LOCALE cookie (no `[locale]` URL segment).
// The request config merges the namespaced message files for the active locale.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

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
      `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@hardware/core", "@hardware/auth", "@hardware/ui"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
