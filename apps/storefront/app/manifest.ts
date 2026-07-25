import type { MetadataRoute } from "next";

// PWA web app manifest — served at /manifest.webmanifest. Makes the storefront
// installable ("Add to Home Screen"): its own icon, standalone/fullscreen launch.
// Icons live in /public/icons (generated). The name here is static (baked into the
// installed app); the in-app shop name still comes from StoreConfig.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sadguru Kripa Hardware",
    short_name: "Sadguru",
    description: "Paint, electrical, plumbing, tools and more — for trade and home.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f1ea",
    theme_color: "#b05d1b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
