"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { InvoiceDTO } from "@hardware/core";
import {
  Button,
  Input,
  Label,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  toast,
  formatMoney,
} from "@hardware/ui";
import {
  cancelInvoiceAction,
  createCreditNoteAction,
  type PakkaActionState,
  type CreditNoteActionState,
} from "../../actions";

// S5 invoice corrections UI: cancel (reason) + create-credit-note (pick lines +
// refund mode). Both actions enforce permission + audit server-side (bill.cancel is
// owner-only; bill.creditnote.create). This UI is gated cosmetically by the server
// page passing canCancel / canCredit; the real gate is the core guard.

export interface LineLabel {
  productId: string;
  saleUnitId: string;
  label: string; // "Finolex Wire — metre"
  saleQty: string;
}

export function InvoiceActions({
  invoice,
  lineLabels,
  canCancel,
  canCredit,
}: {
  invoice: InvoiceDTO;
  lineLabels: LineLabel[];
  canCancel: boolean;
  canCredit: boolean;
}) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [showCancel, setShowCancel] = useState(false);
  const [showCredit, setShowCredit] = useState(false);

  const [cancelState, cancelAction, cancelPending] = useActionState<PakkaActionState, FormData>(
    async (prev, fd) => {
      const r = await cancelInvoiceAction(invoice.id, prev, fd);
      if (r.ok) {
        toast.success(t("actions.toastCancelled", { invoiceNo: invoice.invoiceNo }), {
          description: t("actions.toastCancelledDesc"),
        });
        setShowCancel(false);
        router.refresh();
      } else if (r.error) {
        toast.error(r.error);
      }
      return r;
    },
    {},
  );

  const [cnState, cnAction, cnPending] = useActionState<CreditNoteActionState, FormData>(
    async (prev, fd) => {
      const r = await createCreditNoteAction(invoice.id, prev, fd);
      if (r.ok && r.creditNote) {
        toast.success(t("actions.toastCreditNoteIssued", { creditNoteNo: r.creditNote.creditNoteNo }), {
          description: `${formatMoney(r.creditNote.grandTotal)} · ${r.creditNote.refundMode}`,
        });
        setShowCredit(false);
        router.refresh();
      } else if (r.error) {
        toast.error(r.error);
      }
      return r;
    },
    {},
  );

  if (invoice.status === "CANCELLED") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {t.rich("actions.cancelledNotice", { b: (chunks) => <strong>{chunks}</strong> })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canCancel && (
        <Button type="button" variant="destructive" onClick={() => setShowCancel(true)}>
          {t("actions.cancelInvoice")}
        </Button>
      )}
      {canCredit && (
        <Button type="button" variant="outline" onClick={() => setShowCredit(true)}>
          {t("actions.createCreditNote")}
        </Button>
      )}
      {!canCancel && !canCredit && (
        <span className="text-sm text-muted-foreground">
          {t("actions.noPermission")}
        </span>
      )}

      {/* Cancel (owner-only) — destructive confirm dialog */}
      {canCancel && (
        <Dialog open={showCancel} onOpenChange={setShowCancel}>
          <DialogContent>
            <form action={cancelAction} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t("actions.cancelTitle", { invoiceNo: invoice.invoiceNo })}</DialogTitle>
                <DialogDescription>
                  {t("actions.cancelDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                <Label htmlFor="cancel-reason" required>
                  {t("actions.cancelReasonLabel")}
                </Label>
                <Input
                  id="cancel-reason"
                  name="reason"
                  required
                  placeholder={t("actions.cancelReasonPlaceholder")}
                  aria-invalid={cancelState.error ? true : undefined}
                />
                {cancelState.error && <p className="text-xs text-destructive">{cancelState.error}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCancel(false)}>
                  {t("actions.keepInvoice")}
                </Button>
                <Button type="submit" variant="destructive" isLoading={cancelPending}>
                  {t("actions.confirmCancel")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Credit note */}
      {canCredit && (
        <Dialog open={showCredit} onOpenChange={setShowCredit}>
          <DialogContent className="max-w-2xl">
            <CreditNoteForm
              invoiceNo={invoice.invoiceNo}
              lineLabels={lineLabels}
              action={cnAction}
              pending={cnPending}
              error={cnState.error}
              onCancel={() => setShowCredit(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreditNoteForm({
  invoiceNo,
  lineLabels,
  action,
  pending,
  error,
  onCancel,
}: {
  invoiceNo: string;
  lineLabels: LineLabel[];
  action: (fd: FormData) => void;
  pending: boolean;
  error?: string;
  onCancel: () => void;
}) {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  // Keep the scroll body within the dialog; the line picker can be long.
  const errRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  return (
    <form action={action} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t("actions.cnTitle", { invoiceNo })}</DialogTitle>
        <DialogDescription>
          {t("actions.cnDescription")}
        </DialogDescription>
      </DialogHeader>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("actions.cnColItem")}</TableHead>
              <TableHead numeric>{t("actions.cnColBilled")}</TableHead>
              <TableHead numeric>{t("actions.cnColReturnQty")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineLabels.map((l, i) => (
              <TableRow key={`${l.productId}-${l.saleUnitId}-${i}`}>
                <TableCell>
                  {l.label}
                  <input type="hidden" name="productId" value={l.productId} />
                  <input type="hidden" name="saleUnitId" value={l.saleUnitId} />
                </TableCell>
                <TableCell numeric>{l.saleQty}</TableCell>
                <TableCell numeric>
                  <Input
                    name="quantity"
                    type="number"
                    step="0.001"
                    min="0"
                    defaultValue="0"
                    aria-label={t("actions.cnReturnQtyFor", { label: l.label })}
                    className="ml-auto w-24 text-right"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cn-refund-mode">{t("actions.cnRefundMode")}</Label>
          <Select id="cn-refund-mode" name="refundMode" defaultValue="CASH">
            <option value="CASH">{t("actions.cnRefundCash")}</option>
            <option value="UPI">{t("actions.cnRefundUpi")}</option>
            <option value="KHATA_ADJUST">{t("actions.cnRefundKhataAdjust")}</option>
            <option value="GATEWAY">{t("actions.cnRefundGateway")}</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cn-reason">{t("actions.cnReason")}</Label>
          <Input id="cn-reason" name="reason" placeholder={t("actions.cnReasonPlaceholder")} />
        </div>
      </div>

      {error && (
        <p ref={errRef} className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tCommon("actions.close")}
        </Button>
        <Button type="submit" isLoading={pending}>
          {t("actions.cnIssue")}
        </Button>
      </DialogFooter>
    </form>
  );
}
