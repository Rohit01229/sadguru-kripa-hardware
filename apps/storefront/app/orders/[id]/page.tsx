import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMyOrder, getPublicProduct } from "@hardware/core";
import {
  Alert,
  Badge,
  Card,
  CheckIcon,
  cn,
  formatDateTime,
  formatMoney,
  formatQty,
} from "@hardware/ui";
import { getCustomerSession } from "../../../lib/session";
import {
  fulfilmentLabel,
  orderStatusLabel,
  orderStatusVariant,
  paymentStatusLabel,
} from "../../../lib/order-status";
import { OrderActions } from "./OrderActions";

const TRACK_STEPS = ["PENDING_PAYMENT", "CONFIRMED", "PACKED", "DISPATCHED", "COMPLETED"] as const;
const STEP_LABEL_KEY: Record<(typeof TRACK_STEPS)[number], string> = {
  PENDING_PAYMENT: "detail.step.placed",
  CONFIRMED: "detail.step.confirmed",
  PACKED: "detail.step.packed",
  DISPATCHED: "detail.step.dispatched",
  COMPLETED: "detail.step.completed",
};

// Order tracking / detail (04 §8). OWNERSHIP-scoped (getMyOrder returns null for
// another customer's order → 404). Shows the status timeline, lines, totals, and
// cancel (before dispatch) + reorder.
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession();
  if (!session || !session.customerId) redirect("/account");

  const t = await getTranslations("orders");

  const { id } = await params;
  const order = await getMyOrder(session.customerId, id);
  if (!order) notFound();

  // Resolve display names + sale-unit labels for the lines (small N).
  const enriched = await Promise.all(
    order.lines.map(async (l) => {
      const p = await getPublicProduct(l.productId);
      const su = p?.saleUnits.find((s) => s.id === l.saleUnitId);
      return {
        ...l,
        name: p?.name ?? l.productId,
        unitLabel: su ? `${su.unitName} (${su.unitCode})` : l.saleUnitId,
      };
    }),
  );

  const canCancel = order.status !== "DISPATCHED" && order.status !== "COMPLETED" && order.status !== "CANCELLED";
  // PAY_LATER (pay-at-store) is not a TRACK_STEPS member, so indexOf would return -1
  // and render the whole timeline (incl. "Placed") as not-done — contradicting the
  // "Pay at store" badge. Treat it as the first node ("Placed", same index as
  // PENDING_PAYMENT) so a freshly placed pay-later order reads as placed.
  const timelineStatus = order.status === "PAY_LATER" ? "PENDING_PAYMENT" : order.status;
  const currentStep = TRACK_STEPS.indexOf(timelineStatus as (typeof TRACK_STEPS)[number]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/orders"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
      >
        ← {t("detail.backToOrders")}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{order.orderNo}</h1>
        <Badge variant={orderStatusVariant(order.status)}>{orderStatusLabel(order.status)}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("detail.placedMeta", {
          date: formatDateTime(order.createdAt),
          fulfilment: fulfilmentLabel(order.fulfilment),
          payment: paymentStatusLabel(order.paymentStatus),
        })}
      </p>

      {order.status !== "CANCELLED" && (
        <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-3">
          {TRACK_STEPS.map((s, i) => {
            const done = i <= currentStep;
            return (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    done
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {done && <CheckIcon width={12} height={12} aria-hidden="true" />}
                  {t(STEP_LABEL_KEY[s])}
                </span>
                {i < TRACK_STEPS.length - 1 && (
                  <span className="text-muted-foreground" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {order.reservationExpiresAt && order.status === "PENDING_PAYMENT" && (
        <Alert
          variant="warning"
          className="mt-4"
          description={t("detail.reservationNotice", {
            date: formatDateTime(order.reservationExpiresAt),
          })}
        />
      )}

      <Card className="mt-6 divide-y">
        {enriched.map((l) => (
          <div
            key={`${l.productId}:${l.saleUnitId}`}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{l.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatQty(l.saleQty)} × {l.unitLabel} @ {formatMoney(l.unitPrice)}
              </p>
            </div>
            <span className="text-sm font-medium tabular-nums">{formatMoney(l.lineTotal)}</span>
          </div>
        ))}
      </Card>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("detail.itemTotal")}</span>
          <span className="tabular-nums">{formatMoney(order.itemTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("detail.deliveryFee")}</span>
          <span className="tabular-nums">
            {order.deliveryFee === 0 ? t("detail.free") : formatMoney(order.deliveryFee)}
          </span>
        </div>
        <div className="flex justify-between border-t pt-2 text-base font-semibold">
          <span>{t("detail.grandTotal")}</span>
          <span className="tabular-nums">{formatMoney(order.grandTotal)}</span>
        </div>
      </div>

      {order.invoice && (
        <Alert
          variant="success"
          className="mt-4"
          description={
            <>
              {t("detail.invoiceNotice")}{" "}
              <span className="font-medium">{order.invoice.invoiceNo}</span>
            </>
          }
        />
      )}

      <OrderActions
        orderId={order.id}
        canCancel={canCancel}
        reorderLines={enriched.map((l) => ({
          productId: l.productId,
          saleUnitId: l.saleUnitId,
          quantity: l.saleQty,
          name: l.name,
          unitLabel: l.unitLabel,
          unitPricePaise: l.unitPrice,
        }))}
      />
    </div>
  );
}
