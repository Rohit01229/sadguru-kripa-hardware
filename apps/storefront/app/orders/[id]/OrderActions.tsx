"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@hardware/ui";
import { useCart } from "../../cart/CartStore";

interface ReorderLine {
  productId: string;
  saleUnitId: string;
  quantity: string;
  name: string;
  unitLabel: string;
  unitPricePaise: number;
}

// Order-detail client actions: cancel (before dispatch → releases the reservation)
// and reorder (re-populate the cart from this order's lines, then go to cart).
export function OrderActions({
  orderId,
  canCancel,
  reorderLines,
}: {
  orderId: string;
  canCancel: boolean;
  reorderLines: ReorderLine[];
}) {
  const router = useRouter();
  const t = useTranslations("orders");
  const { addLine } = useCart();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function cancel() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Customer cancelled" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error?.message ?? t("actions.couldNotCancel"));
      setBusy(false);
      return;
    }
    setBusy(false);
    setConfirmOpen(false);
    toast.success(t("actions.cancelledToastTitle"), {
      description: t("actions.cancelledToastDescription"),
    });
    router.refresh();
  }

  function reorder() {
    for (const l of reorderLines) addLine(l);
    toast.success(t("actions.reorderedToast"));
    router.push("/cart");
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Button variant="outline" onClick={reorder}>
        {t("actions.reorder")}
      </Button>

      {canCancel && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            {t("actions.cancelOrder")}
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("actions.confirmTitle")}</DialogTitle>
              <DialogDescription>{t("actions.confirmDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose>
                <Button variant="outline" disabled={busy}>
                  {t("actions.keepOrder")}
                </Button>
              </DialogClose>
              <Button variant="destructive" onClick={cancel} isLoading={busy}>
                {t("actions.cancelOrder")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
