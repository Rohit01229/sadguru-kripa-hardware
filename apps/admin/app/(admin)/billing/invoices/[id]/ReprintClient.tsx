"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { InvoiceDTO } from "@hardware/core";
import { Button, Label, Select } from "@hardware/ui";
import { InvoicePrint, type PrintSize, type StoreBranding, type LineLabelLookup } from "../../print/Templates";

// Reprint controls: pick a print size, render the invoice template, and print on
// demand (window.print). Branding comes from StoreConfig (passed by the server page).
// Print templates + isolation rule are owned by the print worker — this only polishes
// the on-screen chrome around them (§4.6).
export function ReprintClient({
  invoice,
  store,
  lineLabels,
}: {
  invoice: InvoiceDTO;
  store: StoreBranding;
  /** Product/unit names so the receipt prints readable lines (not raw ids). */
  lineLabels?: LineLabelLookup[];
}) {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  const [size, setSize] = useState<PrintSize>("thermal3");
  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="reprint-size">{t("detail.printSize")}</Label>
          <Select
            id="reprint-size"
            value={size}
            onChange={(e) => setSize(e.target.value as PrintSize)}
            className="w-40"
          >
            <option value="thermal2">Thermal 2&quot;</option>
            <option value="thermal3">Thermal 3&quot;</option>
            <option value="a5">A5</option>
            <option value="a4">A4</option>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          {tCommon("actions.print")}
        </Button>
      </div>
      <InvoicePrint invoice={invoice} store={store} size={size} lineLabels={lineLabels} />
    </div>
  );
}
