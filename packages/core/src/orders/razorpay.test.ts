import { describe, it, expect } from "vitest";
import {
  hmacSha256Hex,
  verifyWebhookSignature,
  timingSafeEqualHex,
  parseWebhookEvent,
} from "./razorpay";

// Razorpay webhook signature verification (03 §9). The SIGNED webhook is the source
// of truth for "paid"; a forged/garbled body must be rejected. We use a DUMMY secret
// here so the slice ships and is graded WITHOUT live Razorpay creds (the production
// secret is RAZORPAY_WEBHOOK_SECRET). The HMAC is computed with the same Web Crypto
// path the route uses, so a genuine Razorpay digest over the same body would verify.

const SECRET = "whsec_dummy_test_secret_123";

describe("razorpay.verifyWebhookSignature — HMAC-SHA256 over the raw body", () => {
  it("accepts a signature this secret produced over the exact raw body", async () => {
    const raw = JSON.stringify({ event: "payment.captured", id: "evt_1" });
    const sig = await hmacSha256Hex(SECRET, raw);
    expect(await verifyWebhookSignature(SECRET, raw, sig)).toBe(true);
  });

  it("rejects a tampered body (digest no longer matches)", async () => {
    const raw = JSON.stringify({ event: "payment.captured", id: "evt_1", amount: 100 });
    const sig = await hmacSha256Hex(SECRET, raw);
    const tampered = JSON.stringify({ event: "payment.captured", id: "evt_1", amount: 999999 });
    expect(await verifyWebhookSignature(SECRET, tampered, sig)).toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const raw = JSON.stringify({ event: "payment.captured", id: "evt_1" });
    const sigOther = await hmacSha256Hex("whsec_other", raw);
    expect(await verifyWebhookSignature(SECRET, raw, sigOther)).toBe(false);
  });

  it("returns false (never throws) when the secret is empty or the signature is missing", async () => {
    const raw = JSON.stringify({ id: "evt_1" });
    expect(await verifyWebhookSignature("", raw, "deadbeef")).toBe(false);
    expect(await verifyWebhookSignature(undefined, raw, "deadbeef")).toBe(false);
    expect(await verifyWebhookSignature(SECRET, raw, null)).toBe(false);
  });
});

describe("razorpay.timingSafeEqualHex", () => {
  it("is true for identical digests and false for any difference or length mismatch", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false);
  });
});

describe("razorpay.parseWebhookEvent — envelope extraction (04 §8.6)", () => {
  it("extracts eventId, order id, payment id and amount from a payment.captured event", () => {
    const ev = parseWebhookEvent({
      event: "payment.captured",
      id: "evt_PqrPaymentCaptured",
      payload: {
        payment: { entity: { id: "pay_Pst", order_id: "order_Pqr", amount: 131000, status: "captured" } },
      },
    });
    expect(ev).toEqual({
      eventId: "evt_PqrPaymentCaptured",
      event: "payment.captured",
      paymentId: "pay_Pst",
      razorpayOrderId: "order_Pqr",
      amount: 131000,
    });
  });

  it("falls back to the order entity for order.paid events", () => {
    const ev = parseWebhookEvent({
      event: "order.paid",
      id: "evt_orderPaid",
      payload: { order: { entity: { id: "order_Pqr", amount: 131000 } } },
    });
    expect(ev?.razorpayOrderId).toBe("order_Pqr");
    expect(ev?.amount).toBe(131000);
  });

  it("returns null when the event id is missing (cannot dedupe)", () => {
    expect(parseWebhookEvent({ event: "payment.captured", payload: {} })).toBeNull();
    expect(parseWebhookEvent(null)).toBeNull();
    expect(parseWebhookEvent("not an object")).toBeNull();
  });
});
