import { cookies } from "next/headers";
import { getPrimaryShopId, getStoreConfig } from "@hardware/core";
import { getPinStatus, DEVICE_COOKIE } from "@hardware/auth";
import { LoginSwitcher } from "./LoginSwitcher";

// Staff sign-in page. Server component so the heading can reflect the configurable
// shop name (StoreConfig) instead of a hardcoded string; the interactive form lives
// in LoginForm (client). StoreConfig is public branding, safe to read pre-auth.
export default async function LoginPage() {
  let storeName = "My Hardware Store";
  try {
    const shopId = await getPrimaryShopId();
    const config = shopId ? await getStoreConfig(shopId) : null;
    if (config?.name) storeName = config.name;
  } catch {
    // StoreConfig unavailable — keep the fallback heading.
  }

  // If this device has been remembered, offer the PIN pad instead of the password form.
  // Only the display name is exposed pre-auth — enough to greet them, not enough to
  // tell a stranger holding the device which account it belongs to.
  const store = await cookies();
  const pin = await getPinStatus(store.get(DEVICE_COOKIE)?.value);

  return (
    <LoginSwitcher
      storeName={storeName}
      pinAvailable={pin.available}
      staffName={pin.staffName}
    />
  );
}
