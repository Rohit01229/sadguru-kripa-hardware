"use client";

import { useState, useTransition } from "react";
import { Button } from "@hardware/ui";
import { setShopStatusAction } from "./actions";

/**
 * Suspend or re-activate a tenant. Suspending is confirmed first because it signs every
 * one of that shop's staff out immediately — a mis-click stops someone's business.
 */
export function ShopStatusButton({
  shopId,
  shopName,
  status,
}: {
  shopId: string;
  shopName: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const suspended = status === "SUSPENDED";

  function apply(next: "ACTIVE" | "SUSPENDED") {
    startTransition(async () => {
      const res = await setShopStatusAction(shopId, next);
      setConfirming(false);
      if (res.error) alert(res.error);
    });
  }

  if (suspended) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => apply("ACTIVE")}>
        Reactivate
      </Button>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sign out {shopName}?</span>
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => apply("SUSPENDED")}>
          Suspend
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          No
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
      Suspend
    </Button>
  );
}
