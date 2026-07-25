import { getStoreConfig } from "@hardware/core";
import { LoginForm } from "./LoginForm";

// Staff sign-in page. Server component so the heading can reflect the configurable
// shop name (StoreConfig) instead of a hardcoded string; the interactive form lives
// in LoginForm (client). StoreConfig is public branding, safe to read pre-auth.
export default async function LoginPage() {
  let storeName = "My Hardware Store";
  try {
    const config = await getStoreConfig();
    if (config?.name) storeName = config.name;
  } catch {
    // StoreConfig unavailable — keep the fallback heading.
  }

  return <LoginForm storeName={storeName} />;
}
