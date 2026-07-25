"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button, toast } from "@hardware/ui";
import {
  acceptOrderAction,
  packOrderAction,
  dispatchOrderAction,
  completeOrderAction,
  type FulfilState,
} from "./actions";

// Per-order fulfilment controls: the single next action for the order's status
// (accept → pack → dispatch → complete). Dispatch surfaces the generated invoice no.
// Results are presented through the shared toast channel (§4.5) — the action return
// values are unchanged.
export function FulfilButtons({ id, status }: { id: string; status: string }) {
  const t = useTranslations("orders");
  const [pending, startTransition] = useTransition();

  function run(label: string, fn: () => Promise<FulfilState>) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
      } else if (res.invoice) {
        toast.success(t("toast.dispatched"), {
          description: t("toast.invoiceGenerated", { invoiceNo: res.invoice.invoiceNo }),
        });
      } else {
        toast.success(t("toast.actionDone", { label }));
      }
    });
  }

  const showAccept = status === "PENDING_PAYMENT" || status === "PAY_LATER";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showAccept && (
        <Button
          size="sm"
          variant="outline"
          isLoading={pending}
          onClick={() => run(t("actions.accept"), () => acceptOrderAction(id))}
        >
          {t("actions.accept")}
        </Button>
      )}
      {status === "CONFIRMED" && (
        <Button
          size="sm"
          variant="outline"
          isLoading={pending}
          onClick={() => run(t("actions.pack"), () => packOrderAction(id))}
        >
          {t("actions.pack")}
        </Button>
      )}
      {status === "PACKED" && (
        <Button size="sm" isLoading={pending} onClick={() => run(t("actions.dispatch"), () => dispatchOrderAction(id))}>
          {t("actions.dispatch")}
        </Button>
      )}
      {status === "DISPATCHED" && (
        <Button
          size="sm"
          variant="outline"
          isLoading={pending}
          onClick={() => run(t("actions.complete"), () => completeOrderAction(id))}
        >
          {t("actions.complete")}
        </Button>
      )}
    </div>
  );
}
