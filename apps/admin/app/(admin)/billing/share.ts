// Share a finished bill with the customer (19 §5 — myBillBook parity: "share, don't
// just print"). For an Indian shopkeeper, sending the bill on WhatsApp IS the modern
// receipt; print is the fallback, not the default.
//
// SCOPE, honestly: `wa.me` can carry TEXT only — a browser cannot attach a generated
// PDF to WhatsApp. So we send a clean, complete text receipt (shop, bill no, items,
// total) which is what most counter shops actually send, and leave "Download PDF"
// next to it for when the customer wants the formal tax invoice. Attaching the PDF
// automatically needs the WhatsApp Business API (a paid, per-message integration) —
// that is a later decision, not something to fake here.

/** Digits-only phone, with India's country code when the number is a bare 10-digit one. */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (digits.length === 10) return `91${digits}`;
  // Already carries a country code (or is a landline with STD) — send as-is.
  if (digits.length > 10) return digits;
  return null;
}

export interface ShareInvoice {
  invoiceNo: string;
  grandTotal: number; // paise
  date?: string | Date;
  lines: { qty: string | number; name: string; amount: number }[];
}

/** ₹ with Indian digit grouping, from paise. */
function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The message body. Deliberately plain text — WhatsApp renders `*bold*` but nothing
 * fancier, and a receipt should stay readable if the formatting is stripped.
 */
export function buildShareText(invoice: ShareInvoice, storeName: string, note?: string): string {
  const when = invoice.date ? new Date(invoice.date) : new Date();
  const dateStr = when.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const items = invoice.lines
    .map((l) => `• ${l.name} × ${l.qty} — ${rupees(l.amount)}`)
    .join("\n");

  return [
    `*${storeName}*`,
    `Bill ${invoice.invoiceNo} · ${dateStr}`,
    "",
    items,
    "",
    `*Total: ${rupees(invoice.grandTotal)}*`,
    "",
    note ?? "Thank you for your business!",
  ].join("\n");
}

/**
 * A `wa.me` deep link. With a phone it opens that chat; without one WhatsApp asks the
 * shopkeeper to pick a contact — which is the right behaviour for a walk-in customer
 * whose number we never captured.
 */
export function buildWhatsAppUrl(
  invoice: ShareInvoice,
  storeName: string,
  phone?: string | null,
  note?: string,
): string {
  const text = encodeURIComponent(buildShareText(invoice, storeName, note));
  const to = normalisePhone(phone);
  return to ? `https://wa.me/${to}?text=${text}` : `https://wa.me/?text=${text}`;
}

/** `sms:` link — the fallback for a customer who is not on WhatsApp. */
export function buildSmsUrl(invoice: ShareInvoice, storeName: string, phone?: string | null): string {
  const body = encodeURIComponent(buildShareText(invoice, storeName));
  const to = normalisePhone(phone);
  return to ? `sms:+${to}?body=${body}` : `sms:?body=${body}`;
}
