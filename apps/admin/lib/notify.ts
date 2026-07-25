// Order-status notifications (S6; queued for S7's QStash arm). v1 sends order-status
// email via Resend. RUNTIME-DEFERRED: when RESEND_API_KEY is empty, we DO NOT crash —
// we log the intended notification (a queue stub) so the dispatch flow completes in
// dev. When the key is present, the email is sent best-effort (a notify failure never
// fails the order transaction — it already committed).
import { createLogger, type KhataReminderCustomer } from "@hardware/core";

/**
 * Send (or stub) a khata dues reminder email for an overdue customer (S7 jobs arm).
 * Best-effort and non-throwing — a single send failure must not fail the reminders
 * job (the next cron run re-collects the same overdue customer). RUNTIME-DEFERRED when
 * RESEND_API_KEY is empty: logs the intended reminder as a queue stub.
 */
export async function sendKhataReminder(customer: KhataReminderCustomer): Promise<void> {
  const log = createLogger({ app: "admin", requestId: customer.customerId });
  const apiKey = process.env.RESEND_API_KEY;
  const rupees = (customer.outstanding / 100).toFixed(2);
  if (!apiKey) {
    log.info("khata reminder queued (stub — RESEND_API_KEY unset)", {
      customerId: customer.customerId,
      outstanding: customer.outstanding,
    });
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "dues@hardware.local",
        to: process.env.RESEND_TEST_TO ?? "customer@example.com",
        subject: `Payment reminder — ₹${rupees} outstanding`,
        text: `Dear ${customer.name}, our records show ₹${rupees} outstanding (incl. ₹${(customer.bucket60plus / 100).toFixed(2)} over 60 days). Kindly clear at your earliest.`,
      }),
    });
  } catch (e) {
    log.warn("khata reminder send error (non-fatal)", { err: String(e) });
  }
}

export interface OrderStatusEmail {
  orderId: string;
  status: "CONFIRMED" | "PACKED" | "DISPATCHED" | "COMPLETED" | "CANCELLED";
  /** The pakka invoice number, included on the DISPATCHED email. */
  invoiceNo?: string;
}

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Queue (or send) an order-status email. Best-effort and non-throwing: the order
 * mutation has already committed, so a notify failure must never surface as an error.
 * Returns `{ queued, sent }` so the caller/report can see whether it was a stub.
 */
export async function queueOrderStatusEmail(
  input: OrderStatusEmail,
): Promise<{ queued: boolean; sent: boolean; deferred: boolean }> {
  const log = createLogger({ app: "admin", requestId: input.orderId });
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // RUNTIME-DEFERRED: no Resend key. Log the intended email as a queue stub.
    log.info("order-status email queued (stub — RESEND_API_KEY unset)", {
      orderId: input.orderId,
      status: input.status,
      invoiceNo: input.invoiceNo,
    });
    return { queued: true, sent: false, deferred: true };
  }

  try {
    const subject =
      input.status === "DISPATCHED"
        ? `Your order has been dispatched — invoice ${input.invoiceNo ?? ""}`.trim()
        : `Order update: ${input.status}`;
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "orders@hardware.local",
        to: process.env.RESEND_TEST_TO ?? "customer@example.com",
        subject,
        text: `Order ${input.orderId} is now ${input.status}.${input.invoiceNo ? ` Invoice ${input.invoiceNo}.` : ""}`,
      }),
    });
    if (!res.ok) {
      log.warn("order-status email send failed (non-fatal)", { status: res.status });
      return { queued: true, sent: false, deferred: false };
    }
    return { queued: true, sent: true, deferred: false };
  } catch (e) {
    log.warn("order-status email error (non-fatal)", { err: String(e) });
    return { queued: true, sent: false, deferred: false };
  }
}
