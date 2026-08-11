"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Alert,
  toast,
} from "@hardware/ui";
import type { SalesDocDTO } from "@hardware/core";
import { buildWhatsAppUrl } from "../billing/share";
import { cancelSalesDocAction } from "./actions";

/**
 * What a shopkeeper does with a saved document: send it, bill it, revise it, drop it.
 *
 * "Convert to bill" does NOT create the invoice here. It hands the document to the
 * counter (`/billing?fromDoc=…`), which loads the lines into the cart. That matters
 * because quantities and rates routinely change between the quote and the sale — a
 * one-click conversion would raise a bill the shopkeeper never got to look at, and a
 * finalised invoice cannot be edited afterwards.
 */
export function SalesDocActions({
  doc,
  slug,
  storeName,
  mayWrite,
}: {
  doc: SalesDocDTO;
  slug: string;
  storeName: string;
  mayWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const shareUrl = buildWhatsAppUrl(
    {
      invoiceNo: doc.docNo,
      grandTotal: doc.grandTotal,
      date: doc.date,
      lines: doc.lines.map((l) => ({
        name: l.productName,
        qty: `${l.saleQty} ${l.unitCode}`.trim(),
        amount: l.lineTotal,
      })),
    },
    storeName,
    doc.customerPhone,
    doc.kind === "DELIVERY_CHALLAN"
      ? "Goods sent as above. The bill will follow."
      : "This is an estimate, not a bill. Let us know and we will confirm.",
  );

  function cancelDoc() {
    if (!reason.trim()) {
      setError("Say why this is being cancelled.");
      return;
    }
    start(async () => {
      const res = await cancelSalesDocAction(doc.id, reason.trim());
      if (res.error) {
        setError(res.error);
        toast.error(res.error);
      } else {
        setConfirming(false);
        setReason("");
        setError(null);
        toast.success(`${doc.docNo} cancelled`);
        router.refresh();
      }
    });
  }

  const open = doc.status === "OPEN";

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {error && <Alert variant="destructive">{error}</Alert>}

        {open && mayWrite && (
          <Button asChild className="w-full">
            <Link href={`/billing?fromDoc=${doc.id}`}>Convert to bill</Link>
          </Button>
        )}

        <Button asChild variant="outline" className="w-full">
          <a href={shareUrl} target="_blank" rel="noopener noreferrer">
            Send on WhatsApp
          </a>
        </Button>

        {/* window.print() prints this page; the detail layout hides its chrome with
            print:hidden so what comes out is the document alone. */}
        <Button variant="outline" className="w-full" onClick={() => window.print()}>
          Print
        </Button>

        {open && mayWrite && (
          <Button asChild variant="ghost" className="w-full">
            <Link href={`/sales/${slug}/${doc.id}/edit`}>Edit</Link>
          </Button>
        )}

        {open && mayWrite && !confirming && (
          <Button
            variant="ghost"
            className="w-full text-destructive"
            onClick={() => setConfirming(true)}
          >
            Cancel this {doc.kindLabel.toLowerCase()}
          </Button>
        )}

        {confirming && (
          <div className="space-y-2 rounded-md border p-3">
            <FormField label="Reason" required>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Customer went elsewhere"
                autoFocus
              />
            </FormField>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="flex-1"
                onClick={cancelDoc}
                disabled={pending}
              >
                Cancel it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                Keep
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
