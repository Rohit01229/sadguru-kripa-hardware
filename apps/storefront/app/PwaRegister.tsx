"use client";

import { useEffect } from "react";

// Registers the service worker (/sw.js) once on the client. The SW enables PWA
// install and a network-first shell with an offline fallback; it never caches API
// or dynamic HTML, so live data + auth are unaffected. Failures are swallowed —
// a missing/blocked SW must never break the app.
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
