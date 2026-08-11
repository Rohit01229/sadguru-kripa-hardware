"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, FormField, Input, toast } from "@hardware/ui";
import type { PurchaseOrderDTO } from "@hardware/core";
import { cancelPurchaseOrderAction } from "./actions";

/**
 * What a shopkeeper does with a saved order: receive it, print it, revise it, drop it.
 *
 * "Receive goods" does NOT book the stock here. It hands the order to the goods-receipt
 * form (/stock/grn?fromPo=…) with the lines loaded, because what arrives is routinely
 * not what was ordered — short deliveries, substituted brands, a different rate on the
 * invoice. Booking stock in one click would record a receipt nobody checked.
 */
export function PurchaseOrderActions({
  order,
  mayWrite,
}: {
  order: PurchaseOrderDTO;
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function cancelOrder() {
    if (!reason.trim()) {
      setError("Say why this order is being cancelled.");
      return;
    }
    start(async () => {
      const res = await cancelPurchaseOrderAction(order.id, reason.trim());
      if (res.error) {
        setError(res.error);
        toast.error(res.error);
      } else {
        setConfirming(false);
        setReason("");
        setError(null);
        toast.success(`${order.poNo} cancelled`);
        router.refresh();
      }
    });
  }

  const open = order.status === "OPEN";

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {error && <Alert variant="destructive">{error}</Alert>}

        {open && mayWrite && (
          <Button asChild className="w-full">
            <Link href={`/stock/grn?fromPo=${order.id}`}>Receive goods</Link>
          </Button>
        )}

        {/* The detail layout hides its chrome with print:hidden, so what comes out of
            the printer is the order alone — ready to hand or send to the supplier. */}
        <Button variant="outline" className="w-full" onClick={() => window.print()}>
          Print
        </Button>

        {open && mayWrite && (
          <Button asChild variant="ghost" className="w-full">
            <Link href={`/purchases/${order.id}/edit`}>Edit</Link>
          </Button>
        )}

        {open && mayWrite && !confirming && (
          <Button
            variant="ghost"
            className="w-full text-destructive"
            onClick={() => setConfirming(true)}
          >
            Cancel this order
          </Button>
        )}

        {confirming && (
          <div className="space-y-2 rounded-md border p-3">
            <FormField label="Reason" required>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Supplier out of stock"
                autoFocus
              />
            </FormField>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="flex-1"
                onClick={cancelOrder}
                disabled={pending}
              >
                Cancel it
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Keep
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
