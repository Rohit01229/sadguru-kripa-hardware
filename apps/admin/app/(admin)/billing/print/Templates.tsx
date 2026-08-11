"use client";

import type { InvoiceDTO, KachaEstimate, BillTheme, BillAccent } from "@hardware/core";
import { DEFAULT_BILL_THEME, substituteTokens } from "@hardware/core";
import { formatMoney, formatPaisePlain, formatQty } from "@hardware/ui";

// Print templates (S4): thermal 2"/3" + A4/A5, selectable. Branding (name, address,
// GSTIN, bank, T&C) is pulled from StoreConfig (14-impl-plan Chunk 8) — no UPI QR
// per 02. On-demand render (no R2 dependency in S4): the receipt is plain HTML the
// browser prints via window.print(); the @media print block (admin globals.css)
// hides everything except [data-print-receipt].
//
// Print fidelity contract (this file owns the receipt DOM):
//  - Thermal = narrow monospace slip (58/80mm), folded columns, no boxed table.
//  - A4/A5  = formal GST tax invoice: header block, bill-to, ruled line table with a
//    dedicated HSN column, CGST/SGST-or-IGST breakup, discount, round-off, grand
//    total + amount IN WORDS, bank details, T&C, authorised-signatory footer.
// All money is integer paise → formatMoney/formatPaisePlain. Quantities are decimal
// strings → formatQty (never coerced to Number for display).

export type PrintSize = "thermal2" | "thermal3" | "a5" | "a4";

export interface StoreBranding {
  name: string;
  address?: string | null;
  gstin?: string | null;
  bankDetails?: string | null;
  invoiceTerms?: string | null;
  /** Cloudinary URL; shown when the theme enables the logo. */
  logoKey?: string | null;
  phone?: string | null;
}

// ── Bill theme (19 §7) ────────────────────────────────────────────────────────
// The theme only ever *styles and toggles optional blocks*. Everything CGST Rule 46
// requires on a tax invoice — GSTIN, the CGST/SGST-vs-IGST breakup, HSN on A4/A5,
// amount in words, the invoice number — is rendered unconditionally below and is not
// reachable from the config, so no theme can produce a non-compliant bill.

/** Accent tokens → print-safe ink. Deliberately muted: these are printed, not screens. */
const ACCENT_HEX: Record<BillAccent, string> = {
  espresso: "#4a2f1b",
  amber: "#a1601a",
  kraft: "#7a6a52",
  ink: "#1f2937",
  none: "#000000",
};

const FONT_STACK: Record<BillTheme["fontFamily"], string> = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "Courier New", monospace',
};

/**
 * Resolve the theme for a given paper size. Thermal paper overrides some choices
 * because it physically cannot honour them: it is a fixed-width monospace medium, so a
 * serif face and a 14pt base would simply misalign the columns.
 */
function resolveTheme(theme: BillTheme | undefined, size: PrintSize) {
  const t = theme ?? DEFAULT_BILL_THEME;
  const thermal = isThermal(size);
  return {
    ...t,
    accentHex: ACCENT_HEX[t.accent],
    fontStack: thermal ? FONT_STACK.mono : FONT_STACK[t.fontFamily],
    // Thermal is width-constrained: keep it small and dense whatever the theme says.
    basePt: thermal ? Math.min(t.baseSizePt, 9) : t.baseSizePt,
    tight: thermal || t.density === "compact",
    // A boxed/ruled table is unreadable at 58mm — thermal always uses minimal rules.
    borders: thermal ? ("minimal" as const) : t.tableBorders,
    showHsn: !thermal && t.showHsnColumn,
  };
}
type ResolvedTheme = ReturnType<typeof resolveTheme>;

/** Row/table border classes for the chosen border style. */
function tableClasses(rt: ResolvedTheme, thermal: boolean) {
  return {
    head:
      rt.borders === "boxed"
        ? "border border-black"
        : rt.borders === "ruled"
          ? thermal
            ? "border-y"
            : "border-b-2 border-black"
          : "border-b",
    row:
      rt.borders === "boxed"
        ? "border border-gray-400"
        : rt.borders === "ruled"
          ? thermal
            ? ""
            : "border-b border-gray-300"
          : "",
  };
}

/** Optional human label for an invoice line, keyed by product + sale unit. When a
 *  match is found the receipt prints the product / unit name instead of the raw id. */
export interface LineLabelLookup {
  productId: string;
  saleUnitId: string;
  /** Display name, e.g. "Birla White Cement — 50kg bag". */
  label: string;
}

const WIDTH: Record<PrintSize, string> = {
  thermal2: "58mm",
  thermal3: "80mm",
  a5: "148mm",
  a4: "210mm",
};

function isThermal(size: PrintSize): boolean {
  return size === "thermal2" || size === "thermal3";
}

function Frame({
  size,
  rt,
  children,
}: {
  size: PrintSize;
  rt: ResolvedTheme;
  children: React.ReactNode;
}) {
  const thermal = isThermal(size);
  return (
    <div
      data-print-receipt
      className={`mx-auto bg-white text-black ${rt.outerBorder ? "border" : ""} ${
        thermal ? "p-2 leading-tight" : rt.tight ? "p-4 leading-snug" : "p-6 leading-snug"
      }`}
      style={{
        width: WIDTH[size],
        fontFamily: rt.fontStack,
        // Point sizes are what a print dialog honours; the nested text-[Npx] utilities
        // stay as relative accents around this base.
        fontSize: `${rt.basePt}pt`,
      }}
    >
      {children}
    </div>
  );
}

function Header({
  store,
  size,
  rt,
  title,
  subtitle,
}: {
  store: StoreBranding;
  size: PrintSize;
  rt: ResolvedTheme;
  title: string;
  subtitle?: string;
}) {
  const thermal = isThermal(size);
  const align = rt.headerAlign === "left" && !thermal ? "text-left" : "text-center";
  const tagline = rt.tagline
    ? substituteTokens(rt.tagline, { shopName: store.name, shopGstin: store.gstin, shopPhone: store.phone })
    : "";
  return (
    <div className={align}>
      {/* Logo is a plain <img> so it survives print and the PDF pipeline alike. */}
      {rt.showLogo && store.logoKey ? (
        <img
          src={store.logoKey}
          alt=""
          className={`mb-1 ${rt.headerAlign === "left" && !thermal ? "" : "mx-auto"}`}
          style={{ maxHeight: thermal ? 28 : 48, maxWidth: "60%", objectFit: "contain" }}
        />
      ) : null}
      <div
        className={thermal ? "text-sm font-bold" : "text-lg font-bold tracking-wide"}
        style={{ color: rt.accentHex }}
      >
        {store.name}
      </div>
      {tagline && <div className={thermal ? "text-[10px]" : "text-[11px] text-gray-700"}>{tagline}</div>}
      {rt.showAddress && store.address && (
        <div className={thermal ? "text-[10px]" : "text-[11px] text-gray-700"}>{store.address}</div>
      )}
      {rt.showContact && store.phone && (
        <div className={thermal ? "text-[10px]" : "text-[11px] text-gray-700"}>Ph: {store.phone}</div>
      )}
      {/* GSTIN is mandatory on a tax invoice — never behind a toggle. */}
      {store.gstin && (
        <div className={thermal ? "text-[10px]" : "text-[11px] text-gray-700"}>GSTIN: {store.gstin}</div>
      )}
      <div
        className={`mt-1 font-semibold ${thermal ? "" : "mt-2 text-base uppercase tracking-wider"}`}
        style={{ color: rt.accentHex }}
      >
        {title}
      </div>
      {subtitle && <div className="text-[10px] text-gray-600">{subtitle}</div>}
    </div>
  );
}

/** Pakka GST invoice (full tax breakup). On thermal it folds to a narrow slip; on
 *  A4/A5 it renders as a formal tax invoice with a ruled, columned table. */
export function InvoicePrint({
  invoice,
  store,
  storeName,
  size,
  lineLabels,
  theme,
}: {
  invoice: InvoiceDTO;
  store?: StoreBranding;
  storeName?: string;
  size: PrintSize;
  /** Optional product/unit names so lines print readable labels instead of ids. */
  lineLabels?: LineLabelLookup[];
  /** Shop's saved look (19 §7). Omitted → documented defaults. */
  theme?: BillTheme;
}) {
  const branding: StoreBranding = store ?? { name: storeName ?? "My Hardware Store" };
  const thermal = isThermal(size);
  const rt = resolveTheme(theme, size);
  const tc = tableClasses(rt, thermal);
  const labelFor = (productId: string, saleUnitId: string): string => {
    const hit = lineLabels?.find((l) => l.productId === productId && l.saleUnitId === saleUnitId);
    return hit?.label ?? productId.slice(0, 8);
  };

  return (
    <Frame size={size} rt={rt}>
      <Header store={branding} size={size} rt={rt} title="TAX INVOICE" />

      {/* Invoice meta + bill-to. On A4/A5 these sit side by side; on thermal they stack. */}
      <div
        className={`mt-2 text-[10px] ${
          thermal ? "space-y-0.5" : "flex justify-between gap-4 border-y py-1.5 text-[11px]"
        }`}
      >
        <div className="space-y-0.5">
          <div>
            <span className="text-gray-600">Invoice No:</span> <span className="font-medium">{invoice.invoiceNo}</span>
          </div>
          <div>
            <span className="text-gray-600">Date:</span> {new Date(invoice.date).toLocaleString("en-IN")}
          </div>
          <div>
            <span className="text-gray-600">Place of supply:</span> {invoice.placeOfSupplyState} ·{" "}
            {invoice.taxKind === "IGST" ? "IGST" : "CGST/SGST"}
          </div>
        </div>
        <div className={`space-y-0.5 ${thermal ? "" : "text-right"}`}>
          <div className="text-gray-600">Bill to</div>
          <div className="font-medium">{invoice.customerName ?? "Walk-in customer"}</div>
          {invoice.customerGstin && <div>GSTIN: {invoice.customerGstin}</div>}
        </div>
      </div>

      {/* Line items */}
      {invoice.lines.length === 0 ? (
        <div className="mt-3 text-center text-[10px] text-gray-500">No line items on this invoice.</div>
      ) : (
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className={`text-left text-[10px] ${tc.head}`} style={{ color: rt.accentHex }}>
              <th className="py-0.5 pr-1">Item</th>
              {rt.showHsn && <th className="py-0.5 px-1">HSN</th>}
              <th className="py-0.5 px-1 text-right">Qty</th>
              <th className="py-0.5 px-1 text-right">Rate</th>
              <th className="py-0.5 px-1 text-right">Taxable</th>
              {!thermal && <th className="py-0.5 px-1 text-right">GST</th>}
              <th className="py-0.5 pl-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => {
              const name = labelFor(l.productId, l.saleUnitId);
              const gst = l.cgst + l.sgst + l.igst;
              return (
                <tr
                  key={i}
                  className={`align-top text-[10px] ${tc.row}`}
                  style={rt.zebraRows && i % 2 === 1 ? { backgroundColor: "#f6f4f1" } : undefined}
                >
                  <td className="py-0.5 pr-1">
                    {name}
                    {/* Thermal has no HSN column, so it rides along with the item name —
                        HSN stays on the invoice whatever the theme says. */}
                    {!rt.showHsn && l.hsnCode ? <span className="text-gray-500"> · HSN {l.hsnCode}</span> : null}
                  </td>
                  {rt.showHsn && <td className="py-0.5 px-1 text-gray-700">{l.hsnCode ?? "—"}</td>}
                  <td className="py-0.5 px-1 text-right tabular-nums">{formatQty(l.saleQty)}</td>
                  <td className="py-0.5 px-1 text-right tabular-nums">{formatPaisePlain(l.unitPrice)}</td>
                  <td className="py-0.5 px-1 text-right tabular-nums">{formatPaisePlain(l.taxableValue)}</td>
                  {!thermal && (
                    <td className="py-0.5 px-1 text-right tabular-nums">
                      {formatPaisePlain(gst)} <span className="text-gray-500">({l.gstRatePct}%)</span>
                    </td>
                  )}
                  <td className="py-0.5 pl-1 text-right font-medium tabular-nums">{formatPaisePlain(l.lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Totals */}
      <div
        className={`mt-2 space-y-0.5 border-t pt-1 text-[10px] ${
          thermal ? "" : "ml-auto w-2/3 border-t-2 border-black"
        }`}
      >
        <Line label="Taxable total" value={invoice.taxableTotal} />
        {invoice.discountTotal > 0 && <Line label="Discount" value={-invoice.discountTotal} />}
        {invoice.taxKind === "CGST_SGST" ? (
          <>
            <Line label="CGST" value={invoice.cgstTotal} />
            <Line label="SGST" value={invoice.sgstTotal} />
          </>
        ) : (
          <Line label="IGST" value={invoice.igstTotal} />
        )}
        {invoice.roundOff !== 0 && <Line label="Round off" value={invoice.roundOff} />}
        <div className="flex justify-between border-t border-black pt-0.5 text-[11px] font-bold">
          <span>Grand total</span>
          <span className="tabular-nums">{formatMoney(invoice.grandTotal)}</span>
        </div>
        {invoice.amountPaid > 0 && <Line label="Paid" value={invoice.amountPaid} />}
        {invoice.changeDue > 0 && <Line label="Change" value={invoice.changeDue} />}
        {invoice.balanceToLedger > 0 && <Line label="Balance (khata)" value={invoice.balanceToLedger} />}
      </div>

      {/* Amount in words — required on the tax invoice. */}
      <div className={`mt-2 text-[10px] ${thermal ? "" : "border-t pt-1"}`}>
        <span className="text-gray-600">Amount in words: </span>
        <span className="font-medium">{rupeesInWords(invoice.grandTotal)}</span>
      </div>

      {/* Optional blocks — each toggled by the theme; content still comes from settings. */}
      {rt.showBankDetails && branding.bankDetails && (
        <div className="mt-2 whitespace-pre-line text-[10px] text-gray-700">
          <span className="font-medium">Bank: </span>
          {branding.bankDetails}
        </div>
      )}
      {rt.showTerms && branding.invoiceTerms && (
        <div className="mt-2 whitespace-pre-line text-[9px] text-gray-600">
          <div className="font-medium text-gray-700">Terms &amp; Conditions</div>
          {branding.invoiceTerms}
        </div>
      )}

      {rt.showSignature &&
        (thermal ? (
          <div className="mt-2 text-center text-[10px]">For {branding.name}</div>
        ) : (
          <div className="mt-6 flex items-end justify-between text-[10px]">
            <div className="text-gray-600">This is a computer-generated invoice.</div>
            <div className="text-right">
              <div className="mt-6 border-t border-black pt-1">For {branding.name}</div>
              <div className="text-gray-600">
                {substituteTokens(rt.signatureLabel, { shopName: branding.name })}
              </div>
            </div>
          </div>
        ))}
      {rt.showFooterNote && rt.footerNote && (
        <div className="mt-2 text-center text-[10px]">
          {substituteTokens(rt.footerNote, {
            shopName: branding.name,
            invoiceNo: invoice.invoiceNo,
            customerName: invoice.customerName,
          })}
        </div>
      )}
    </Frame>
  );
}

/** Kacha estimate (NO tax, NO invoice number — zero-trace; this is a rough slip). */
export function KachaPrint({
  estimate,
  store,
  storeName,
  size,
  theme,
}: {
  estimate: KachaEstimate & { items?: { name: string; qty: string; unit: string }[] };
  store?: StoreBranding;
  storeName?: string;
  size: PrintSize;
  /** Shop's saved look (19 §7). The estimate carries no tax, so only styling applies. */
  theme?: BillTheme;
}) {
  const branding: StoreBranding = store ?? { name: storeName ?? "My Hardware Store" };
  const thermal = isThermal(size);
  const rt = resolveTheme(theme, size);
  const items =
    estimate.items ?? estimate.lines.map((l) => ({ name: l.productId.slice(0, 8), qty: l.quantity, unit: "" }));
  return (
    <Frame size={size} rt={rt}>
      <Header store={branding} size={size} rt={rt} title="ESTIMATE" subtitle="Not a tax invoice" />
      {items.length === 0 ? (
        <div className="mt-3 text-center text-[10px] text-gray-500">No items on this estimate.</div>
      ) : (
        <table className="mt-2 w-full text-[10px]">
          <thead>
            <tr className={`text-left ${thermal ? "border-y" : "border-b-2 border-black"}`}>
              <th className="py-0.5">Item</th>
              <th className="py-0.5 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className={thermal ? "" : "border-b border-gray-300"}>
                <td className="py-0.5">{it.name}</td>
                <td className="py-0.5 text-right tabular-nums">{formatQty(it.qty, it.unit || undefined)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-2 text-center text-[9px] text-gray-500">
        {new Date(estimate.createdAt).toLocaleString("en-IN")}
      </div>
      <div className="mt-1 text-center text-[10px]">For {branding.name}</div>
    </Frame>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-700">{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

// ── Amount in words (Indian system) ────────────────────────────────────────────
// Display-only: converts an integer-paise grand total to an Indian-English words
// string, e.g. 123456 -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Six
// Paise Only". Never used to re-derive money — purely presentational.
const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t]! : `${TENS[t]} ${ONES[o]}`;
}

/** 0–999 → words (used per Indian place group). */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${ONES[h]} Hundred`);
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(" ");
}

function rupeesToWords(rupees: number): string {
  if (rupees === 0) return "Zero";
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;
  const parts: string[] = [];
  if (crore > 0) parts.push(`${rupeesToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred > 0) parts.push(threeDigits(hundred));
  return parts.join(" ");
}

/** Integer paise → "Rupees … and … Paise Only" (Indian numbering). */
export function rupeesInWords(paise: number): string {
  const safe = Number.isFinite(paise) ? Math.trunc(Math.abs(paise)) : 0;
  const rupees = Math.floor(safe / 100);
  const paiseRem = safe % 100;
  const sign = paise < 0 ? "Minus " : "";
  let out = `${sign}Rupees ${rupeesToWords(rupees)}`;
  if (paiseRem > 0) out += ` and ${twoDigits(paiseRem)} Paise`;
  return `${out} Only`;
}
