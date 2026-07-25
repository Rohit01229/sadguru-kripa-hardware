"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import {
  acceptOrder,
  packOrder,
  dispatchOrder,
  completeOrder,
  DomainError,
  Forbidden,
  type OrderDTO,
  type InvoiceDTO,
} from "@hardware/core";
import { getStaffSession } from "../../../lib/session";
import { requestId } from "../../../lib/logger";
import { queueOrderStatusEmail } from "../../../lib/notify";

// Admin fulfilment server actions (transport, S6). Each: resolve the staff session,
// call the core service (which requirePermission(orders.fulfil) + audit in one tx),
// revalidate the queue. Dispatch additionally returns the generated pakka invoice and
// queues the dispatch email (runtime-deferred if RESEND_API_KEY is empty).

export interface FulfilState {
  ok?: boolean;
  error?: string;
  order?: OrderDTO;
  invoice?: InvoiceDTO;
}

async function toError(e: unknown): Promise<string> {
  const t = await getTranslations("orders");
  if (e instanceof Forbidden) return t("errors.forbidden");
  if (e instanceof DomainError) {
    switch (e.code) {
      case "INVALID_TRANSITION":
        return t("errors.invalidTransition");
      case "ALREADY_DISPATCHED":
        return t("errors.alreadyDispatched");
      case "ORDER_CANCELLED":
        return t("errors.cancelled");
      case "NOT_FOUND":
        return t("errors.notFound");
      default:
        return e.message;
    }
  }
  return t("errors.generic");
}

async function ctx() {
  const session = await getStaffSession();
  if (!session) throw new Forbidden("authenticated");
  return { session, requestId: await requestId() };
}

export async function acceptOrderAction(id: string): Promise<FulfilState> {
  try {
    const order = await acceptOrder(id, await ctx());
    revalidatePath("/orders");
    return { ok: true, order };
  } catch (e) {
    return { error: await toError(e) };
  }
}

export async function packOrderAction(id: string): Promise<FulfilState> {
  try {
    const order = await packOrder(id, await ctx());
    revalidatePath("/orders");
    return { ok: true, order };
  } catch (e) {
    return { error: await toError(e) };
  }
}

export async function dispatchOrderAction(id: string): Promise<FulfilState> {
  try {
    const { order, invoice } = await dispatchOrder(id, { roundOff: true }, await ctx());
    await queueOrderStatusEmail({ orderId: order.id, status: "DISPATCHED", invoiceNo: invoice.invoiceNo });
    revalidatePath("/orders");
    revalidatePath("/stock");
    return { ok: true, order, invoice };
  } catch (e) {
    return { error: await toError(e) };
  }
}

export async function completeOrderAction(id: string): Promise<FulfilState> {
  try {
    const order = await completeOrder(id, await ctx());
    revalidatePath("/orders");
    return { ok: true, order };
  } catch (e) {
    return { error: await toError(e) };
  }
}
