"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { code39Svg, LABEL_SHEETS, labelSheet } from "@hardware/core";
import { Button, Card, CardContent, Checkbox, Input, Label, Select, formatMoney } from "@hardware/ui";

export interface LabelProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  /** Default sale-unit price in paise, printed on the label. */
  price: number | null;
}

/**
 * Barcode label sheet builder (19 §12).
 *
 * Pick items, set how many labels each needs, choose the stock, print. The sheet is laid
 * out in **millimetres** rather than pixels: label stock is a physical product, so the
 * grid must land on the die-cuts regardless of screen DPI or browser zoom. `@page` fixes
 * the paper size and kills the browser's default margins, which would otherwise shift
 * every label and ruin the alignment.
 *
 * What gets encoded: the item's barcode when it has one, else its Item Code — so labels
 * are useful immediately for a shop that has never touched the barcode field, and the
 * printed code always resolves back through the POS search either way.
 */
export function LabelSheetBuilder({ products }: { products: LabelProduct[] }) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");

  const [sheetKey, setSheetKey] = useState(LABEL_SHEETS[0]!.key);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName] = useState(true);
  const [filter, setFilter] = useState("");

  const sheet = labelSheet(sheetKey);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
    );
  }, [products, filter]);

  /** Expand the per-item counts into the flat list of labels to print. */
  const labels = useMemo(() => {
    const out: LabelProduct[] = [];
    for (const p of products) {
      const n = counts[p.id] ?? 0;
      for (let i = 0; i < n; i++) out.push(p);
    }
    return out;
  }, [products, counts]);

  const perPage = sheet.columns * sheet.rows;
  const pages = Math.max(1, Math.ceil(labels.length / perPage));

  function setCount(id: string, n: number) {
    setCounts((c) => ({ ...c, [id]: Math.max(0, Math.min(999, n)) }));
  }

  return (
    <div className="space-y-6">
      {/* ── Controls (hidden when printing) ── */}
      <div className="space-y-4 print:hidden">
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sheet">{t("labels.sheet")}</Label>
              <Select id="sheet" value={sheetKey} onChange={(e) => setSheetKey(e.target.value)}>
                {LABEL_SHEETS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter">{t("labels.find")}</Label>
              <Input
                id="filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("labels.findPlaceholder")}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={showName} onChange={(e) => setShowName(e.target.checked)} />
              {t("labels.showName")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
              {t("labels.showPrice")}
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">{t("labels.colItem")}</th>
                    <th className="py-2">{t("labels.colCode")}</th>
                    <th className="w-28 py-2 text-right">{t("labels.colQty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">{p.name}</td>
                      <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">
                        {p.barcode || p.sku}
                      </td>
                      <td className="py-1.5 text-right">
                        <Input
                          type="number"
                          min={0}
                          max={999}
                          value={counts[p.id] ?? 0}
                          onChange={(e) => setCount(p.id, Number(e.target.value) || 0)}
                          className="h-8 w-20 text-right"
                          aria-label={t("labels.qtyFor", { name: p.name })}
                        />
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        {t("labels.noMatch")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => window.print()} disabled={labels.length === 0}>
            {t("labels.print")}
          </Button>
          <Button variant="outline" onClick={() => setCounts({})} disabled={labels.length === 0}>
            {tc("actions.clear")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("labels.summary", { labels: labels.length, pages, perPage })}
          </p>
        </div>
      </div>

      {/* ── The sheet itself. Millimetres, so it lands on the die-cuts. ── */}
      <style>{`
        @page { size: ${sheet.pageWidthMm}mm ${sheet.pageHeightMm}mm; margin: 0; }
        @media print {
          body * { visibility: hidden; }
          #label-sheet, #label-sheet * { visibility: visible; }
          #label-sheet { position: absolute; inset: 0; }
        }
      `}</style>

      <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4 print:overflow-visible print:rounded-none print:border-0 print:bg-white print:p-0">
        <div id="label-sheet" className="mx-auto bg-white">
          {Array.from({ length: pages }, (_, page) => (
            <div
              key={page}
              style={{
                width: `${sheet.pageWidthMm}mm`,
                height: `${sheet.pageHeightMm}mm`,
                paddingTop: `${sheet.marginTopMm}mm`,
                paddingLeft: `${sheet.marginLeftMm}mm`,
                display: "grid",
                gridTemplateColumns: `repeat(${sheet.columns}, ${sheet.labelWidthMm}mm)`,
                gridAutoRows: `${sheet.labelHeightMm}mm`,
                breakAfter: page < pages - 1 ? "page" : "auto",
                boxSizing: "border-box",
              }}
            >
              {labels.slice(page * perPage, (page + 1) * perPage).map((p, i) => (
                <LabelCell
                  key={`${p.id}-${i}`}
                  product={p}
                  showName={showName}
                  showPrice={showPrice}
                  heightMm={sheet.labelHeightMm}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LabelCell({
  product,
  showName,
  showPrice,
  heightMm,
}: {
  product: LabelProduct;
  showName: boolean;
  showPrice: boolean;
  heightMm: number;
}) {
  // Encode the barcode when set, otherwise the Item Code — either way the printed value
  // is one the POS search resolves back to this item.
  const code = product.barcode || product.sku;
  // Scale bars to the label: shorter stock gets shorter bars so text still fits.
  const bar = code39Svg(code, { narrow: 1, height: Math.max(18, heightMm * 1.1), showText: true });

  return (
    <div
      className="flex flex-col items-center justify-center overflow-hidden px-1 text-center"
      style={{ boxSizing: "border-box" }}
    >
      {showName && (
        <div className="w-full truncate text-[7pt] leading-tight text-black">{product.name}</div>
      )}
      {bar ? (
        <div
          className="flex w-full justify-center"
          // The SVG is generated by us from a closed alphabet — no user HTML reaches this.
          dangerouslySetInnerHTML={{ __html: bar.svg }}
          style={{ maxWidth: "100%" }}
        />
      ) : (
        <div className="font-mono text-[8pt] text-black">{code}</div>
      )}
      {showPrice && product.price != null && (
        <div className="text-[8pt] font-semibold leading-tight text-black">
          {formatMoney(product.price)}
        </div>
      )}
    </div>
  );
}
