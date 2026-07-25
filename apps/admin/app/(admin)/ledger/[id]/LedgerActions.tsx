"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input, Select, Label, Button, formatMoney, toast } from "@hardware/ui";
import {
  recordPaymentAction,
  triggerReminderAction,
  type PaymentActionState,
  type ReminderActionState,
} from "../actions";

// Record-payment form + reminder button for a customer's khata (S5). Both actions
// enforce ledger.write + audit server-side; this UI is cosmetic and refreshes the
// statement / aging on success.

export function RecordPaymentForm({ customerId }: { customerId: string }) {
  const t = useTranslations("ledger");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<PaymentActionState, FormData>(async (prev, fd) => {
    const result = await recordPaymentAction(customerId, prev, fd);
    if (result.ok) router.refresh();
    return result;
  }, {});

  // Present the action result via the standard toast channel (§4.5).
  useEffect(() => {
    if (state.ok && state.receipt) {
      toast.success(t("payment.toastRecorded"), {
        description: t("payment.toastRecordedDescription", {
          amount: formatMoney(state.receipt.outstandingAfter),
        }),
      });
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, t]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
    >
      <div className="space-y-1">
        <Label htmlFor="pay-amount" required>
          {t("payment.amount")}
        </Label>
        <Input
          id="pay-amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder={t("payment.amountPlaceholder")}
          className="w-32 text-right tabular-nums"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pay-mode">{t("payment.mode")}</Label>
        <Select id="pay-mode" name="mode" defaultValue="CASH" className="w-28">
          <option value="CASH">{t("payment.modeCash")}</option>
          <option value="UPI">{t("payment.modeUpi")}</option>
          <option value="CARD">{t("payment.modeCard")}</option>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pay-ref">{t("payment.reference")}</Label>
        <Input
          id="pay-ref"
          name="reference"
          placeholder={t("payment.referencePlaceholder")}
          className="w-44"
        />
      </div>
      <Button type="submit" isLoading={pending}>
        {t("payment.recordPayment")}
      </Button>
      {state.error && (
        <span role="alert" className="text-sm text-destructive">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function ReminderButton({ customerId }: { customerId: string }) {
  const t = useTranslations("ledger");
  const [state, formAction, pending] = useActionState<ReminderActionState, FormData>(
    (prev, fd) => triggerReminderAction(customerId, prev, fd),
    {},
  );

  useEffect(() => {
    if (state.ok && state.result) {
      if (state.result.queued) {
        toast.success(t("reminder.toastQueued"), {
          description: t("reminder.toastQueuedDescription"),
        });
      } else {
        toast.info(t("reminder.toastNothing"));
      }
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, t]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="channel" value="EMAIL" />
      <Button type="submit" variant="outline" isLoading={pending}>
        {t("reminder.send")}
      </Button>
      {state.error && (
        <span role="alert" className="text-sm text-destructive">
          {state.error}
        </span>
      )}
    </form>
  );
}
