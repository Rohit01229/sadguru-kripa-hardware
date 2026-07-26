import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceDTO } from "@hardware/core";

// Server-rendered A4 GST tax-invoice PDF (react-pdf — no Chromium, Vercel Hobby-safe).
// Renders the SAME data as the on-screen invoice (InvoiceDTO, integer paise). Uses the
// built-in Helvetica font, so amounts print as "Rs." (Helvetica has no ₹ glyph — using
// "Rs." avoids embedding a font). Printed invoices stay English (project rule).
//
// This is a standalone A4 layout; when the config-driven BillRenderer lands (plan
// S1–S6) this can be regenerated from the shared template config.

export interface InvoicePdfStore {
  name: string;
  address?: string | null;
  gstin?: string | null;
  bankDetails?: string | null;
  invoiceTerms?: string | null;
}

// ── formatting helpers (display-only; never re-derive money) ──
function rs(paise: number): string {
  const v = (paise ?? 0) / 100;
  return "Rs. " + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function qty(s: string): string {
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}
function pct(s: string): string {
  const n = Number(s);
  return (Number.isFinite(n) ? String(n) : s) + "%";
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── amount in words (Indian system) — ported from print/Templates.tsx ──
const ONES = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
const TENS = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
function two(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t]! : `${TENS[t]} ${ONES[o]}`;
}
function three(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const p: string[] = [];
  if (h > 0) p.push(`${ONES[h]} Hundred`);
  if (rest > 0) p.push(two(rest));
  return p.join(" ");
}
function rupeesToWords(r: number): string {
  if (r === 0) return "Zero";
  const crore = Math.floor(r / 10000000);
  const lakh = Math.floor((r % 10000000) / 100000);
  const thousand = Math.floor((r % 100000) / 1000);
  const hundred = r % 1000;
  const p: string[] = [];
  if (crore > 0) p.push(`${rupeesToWords(crore)} Crore`);
  if (lakh > 0) p.push(`${two(lakh)} Lakh`);
  if (thousand > 0) p.push(`${two(thousand)} Thousand`);
  if (hundred > 0) p.push(three(hundred));
  return p.join(" ");
}
function rupeesInWords(paise: number): string {
  const safe = Number.isFinite(paise) ? Math.trunc(Math.abs(paise)) : 0;
  const rupees = Math.floor(safe / 100);
  const rem = safe % 100;
  let out = `Rupees ${rupeesToWords(rupees)}`;
  if (rem > 0) out += ` and ${two(rem)} Paise`;
  return `${out} Only`;
}

// Minimal GST state-code → name map (place of supply).
const GST_STATES: Record<string, string> = {
  "01":"Jammu & Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","27":"Maharashtra","29":"Karnataka","30":"Goa","32":"Kerala","33":"Tamil Nadu","34":"Puducherry","36":"Telangana","37":"Andhra Pradesh",
};
function placeOfSupply(code: string): string {
  const name = GST_STATES[code];
  return name ? `${code} — ${name}` : code;
}

const INK = "#1f2937";
const MUTE = "#6b7280";
const LINE = "#d1d5db";

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8.5, fontFamily: "Helvetica", color: INK },
  frame: { borderWidth: 1, borderColor: INK, padding: 0 },
  title: { textAlign: "center", fontSize: 12, fontFamily: "Helvetica-Bold", letterSpacing: 1, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: INK },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK },
  headLeft: { width: "58%", padding: 8, borderRightWidth: 1, borderRightColor: INK },
  headRight: { width: "42%", padding: 8 },
  shopName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaLabel: { width: "42%", color: MUTE },
  metaValue: { width: "58%", fontFamily: "Helvetica-Bold" },
  partyRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK },
  party: { width: "58%", padding: 8, borderRightWidth: 1, borderRightColor: INK },
  partyR: { width: "42%", padding: 8 },
  sectionLabel: { color: MUTE, marginBottom: 2, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.5 },
  bold: { fontFamily: "Helvetica-Bold" },
  // table
  tHead: { flexDirection: "row", backgroundColor: "#f3f4f6", borderBottomWidth: 1, borderBottomColor: INK },
  tRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE },
  th: { padding: 4, fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  td: { padding: 4, fontSize: 8 },
  cSr: { width: "4%", textAlign: "right" },
  cItem: { width: "23%", textAlign: "left" },
  cHsn: { width: "8%", textAlign: "left" },
  cQty: { width: "8%", textAlign: "right" },
  cRate: { width: "10%", textAlign: "right" },
  cDisc: { width: "8%", textAlign: "right" },
  cTax: { width: "12%", textAlign: "right" },
  cGstP: { width: "6%", textAlign: "right" },
  cGst: { width: "9%", textAlign: "right" },
  cAmt: { width: "12%", textAlign: "right" },
  // totals
  totalsWrap: { flexDirection: "row" },
  totalsLeft: { width: "58%", padding: 8, borderRightWidth: 1, borderRightColor: INK, borderTopWidth: 1, borderTopColor: INK },
  totalsRight: { width: "42%", borderTopWidth: 1, borderTopColor: INK },
  totLine: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 2 },
  totLabel: { width: "58%", textAlign: "right", color: MUTE },
  totValue: { width: "42%", textAlign: "right" },
  grand: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "#f3f4f6", borderTopWidth: 1, borderTopColor: INK },
  words: { padding: 8, borderTopWidth: 1, borderTopColor: INK, borderBottomWidth: 1, borderBottomColor: INK },
  footRow: { flexDirection: "row" },
  footLeft: { width: "62%", padding: 8, borderRightWidth: 1, borderRightColor: INK },
  footRight: { width: "38%", padding: 8, justifyContent: "flex-end" },
  sign: { marginTop: 34, textAlign: "center", borderTopWidth: 0.5, borderTopColor: INK, paddingTop: 2 },
});

export function InvoiceDocument({
  invoice,
  store,
  lineNames,
}: {
  invoice: InvoiceDTO;
  store: InvoicePdfStore;
  lineNames: Record<string, string>;
}) {
  const igst = invoice.taxKind === "IGST";
  return (
    <Document title={`Invoice ${invoice.invoiceNo}`} author={store.name}>
      <Page size="A4" style={s.page}>
        <View style={s.frame}>
          <Text style={s.title}>TAX INVOICE</Text>

          {/* Supplier + invoice meta */}
          <View style={s.headRow}>
            <View style={s.headLeft}>
              <Text style={s.shopName}>{store.name}</Text>
              {store.address ? <Text style={{ color: MUTE, marginTop: 2 }}>{store.address}</Text> : null}
              {store.gstin ? <Text style={{ marginTop: 2 }}>GSTIN: <Text style={s.bold}>{store.gstin}</Text></Text> : null}
            </View>
            <View style={s.headRight}>
              <View style={s.metaRow}><Text style={s.metaLabel}>Invoice No.</Text><Text style={s.metaValue}>{invoice.invoiceNo}</Text></View>
              <View style={s.metaRow}><Text style={s.metaLabel}>Date</Text><Text style={s.metaValue}>{fmtDate(invoice.date)}</Text></View>
              <View style={s.metaRow}><Text style={s.metaLabel}>Place of Supply</Text><Text style={s.metaValue}>{placeOfSupply(invoice.placeOfSupplyState)}</Text></View>
              <View style={s.metaRow}><Text style={s.metaLabel}>Reverse Charge</Text><Text style={s.metaValue}>No</Text></View>
              {invoice.status === "CANCELLED" ? (
                <View style={s.metaRow}><Text style={s.metaLabel}>Status</Text><Text style={[s.metaValue, { color: "#b91c1c" }]}>CANCELLED</Text></View>
              ) : null}
            </View>
          </View>

          {/* Bill to */}
          <View style={s.partyRow}>
            <View style={s.party}>
              <Text style={s.sectionLabel}>Bill To</Text>
              <Text style={s.bold}>{invoice.customerName ?? "Walk-in Customer"}</Text>
              {invoice.customerGstin ? <Text style={{ marginTop: 2 }}>GSTIN: {invoice.customerGstin}</Text> : null}
            </View>
            <View style={s.partyR}>
              <Text style={s.sectionLabel}>Tax Type</Text>
              <Text style={s.bold}>{igst ? "IGST (Inter-state)" : "CGST + SGST (Intra-state)"}</Text>
            </View>
          </View>

          {/* Line table */}
          <View style={s.tHead}>
            <Text style={[s.th, s.cSr]}>#</Text>
            <Text style={[s.th, s.cItem]}>Item</Text>
            <Text style={[s.th, s.cHsn]}>HSN</Text>
            <Text style={[s.th, s.cQty]}>Qty</Text>
            <Text style={[s.th, s.cRate]}>Rate</Text>
            <Text style={[s.th, s.cDisc]}>Disc</Text>
            <Text style={[s.th, s.cTax]}>Taxable</Text>
            <Text style={[s.th, s.cGstP]}>GST%</Text>
            <Text style={[s.th, s.cGst]}>GST</Text>
            <Text style={[s.th, s.cAmt]}>Amount</Text>
          </View>
          {invoice.lines.map((l, i) => {
            const name = lineNames[`${l.productId}::${l.saleUnitId}`] ?? l.productId;
            const lineGst = l.cgst + l.sgst + l.igst;
            return (
              <View style={s.tRow} key={i} wrap={false}>
                <Text style={[s.td, s.cSr]}>{i + 1}</Text>
                <Text style={[s.td, s.cItem]}>{name}</Text>
                <Text style={[s.td, s.cHsn]}>{l.hsnCode ?? "-"}</Text>
                <Text style={[s.td, s.cQty]}>{qty(l.saleQty)}</Text>
                <Text style={[s.td, s.cRate]}>{rs(l.unitPrice)}</Text>
                <Text style={[s.td, s.cDisc]}>{l.lineDiscount ? rs(l.lineDiscount) : "-"}</Text>
                <Text style={[s.td, s.cTax]}>{rs(l.taxableValue)}</Text>
                <Text style={[s.td, s.cGstP]}>{pct(l.gstRatePct)}</Text>
                <Text style={[s.td, s.cGst]}>{rs(lineGst)}</Text>
                <Text style={[s.td, s.cAmt]}>{rs(l.lineTotal)}</Text>
              </View>
            );
          })}

          {/* Totals */}
          <View style={s.totalsWrap}>
            <View style={s.totalsLeft}>
              <Text style={s.sectionLabel}>Amount in Words</Text>
              <Text style={s.bold}>{rupeesInWords(invoice.grandTotal)}</Text>
            </View>
            <View style={s.totalsRight}>
              <View style={s.totLine}><Text style={s.totLabel}>Taxable Value</Text><Text style={s.totValue}>{rs(invoice.taxableTotal)}</Text></View>
              {invoice.discountTotal ? (
                <View style={s.totLine}><Text style={s.totLabel}>Discount</Text><Text style={s.totValue}>- {rs(invoice.discountTotal)}</Text></View>
              ) : null}
              {igst ? (
                <View style={s.totLine}><Text style={s.totLabel}>IGST</Text><Text style={s.totValue}>{rs(invoice.igstTotal)}</Text></View>
              ) : (
                <>
                  <View style={s.totLine}><Text style={s.totLabel}>CGST</Text><Text style={s.totValue}>{rs(invoice.cgstTotal)}</Text></View>
                  <View style={s.totLine}><Text style={s.totLabel}>SGST</Text><Text style={s.totValue}>{rs(invoice.sgstTotal)}</Text></View>
                </>
              )}
              {invoice.roundOff ? (
                <View style={s.totLine}><Text style={s.totLabel}>Round Off</Text><Text style={s.totValue}>{rs(invoice.roundOff)}</Text></View>
              ) : null}
              <View style={s.grand}><Text style={[s.totLabel, s.bold]}>Grand Total</Text><Text style={[s.totValue, s.bold]}>{rs(invoice.grandTotal)}</Text></View>
            </View>
          </View>

          {/* Bank + terms */}
          {store.bankDetails || store.invoiceTerms ? (
            <View style={s.words}>
              {store.bankDetails ? (
                <View style={{ marginBottom: store.invoiceTerms ? 4 : 0 }}>
                  <Text style={s.sectionLabel}>Bank Details</Text>
                  <Text>{store.bankDetails}</Text>
                </View>
              ) : null}
              {store.invoiceTerms ? (
                <View>
                  <Text style={s.sectionLabel}>Terms &amp; Conditions</Text>
                  <Text>{store.invoiceTerms}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Footer / signature */}
          <View style={s.footRow}>
            <View style={s.footLeft}>
              <Text style={{ color: MUTE }}>This is a computer-generated tax invoice.</Text>
            </View>
            <View style={s.footRight}>
              <Text style={s.bold}>For {store.name}</Text>
              <Text style={s.sign}>Authorised Signatory</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
