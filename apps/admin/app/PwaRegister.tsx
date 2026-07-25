"use client";

import { useEffect } from "react";

// Registers the service worker (/sw.js) once on the client. Enables PWA install +
// an offline fallback; never caches API or dynamic HTML, so live data + the staff
// session are unaffected. Failures are swallowed so a blocked SW can't break login.
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
