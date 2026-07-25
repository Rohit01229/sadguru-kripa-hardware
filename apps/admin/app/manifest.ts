import type { MetadataRoute } from "next";

// PWA web app manifest — served at /manifest.webmanifest. Makes the admin console
// installable on the counter phone/tablet (own icon, standalone/fullscreen). Icons
// live in /public/icons. The espresso/gold theme distinguishes it from the amber
// storefront app when both are installed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sadguru Kripa Hardware — Admin",
    short_name: "SK Admin",
    description: "Billing, stock, ledger and reports for Sadguru Kripa Hardware.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f1ea",
    theme_color: "#2f2018",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
