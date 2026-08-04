"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  BILL_THEME_PRESETS,
  BILL_ACCENTS,
  BILL_FONTS,
  BILL_DENSITY,
  BILL_TABLE_BORDERS,
  BILL_ALIGN,
  type BillTheme,
} from "@hardware/core";
import { Button, Card, CardContent, Checkbox, FormField, Input, Label, Select, toast } from "@hardware/ui";
import { InvoicePrint, type PrintSize, type StoreBranding } from "../../billing/print/Templates";
import { saveBillThemeAction } from "./actions";
import { SAMPLE_INVOICE, SAMPLE_LINE_LABELS } from "./sample";

/**
 * No-code bill-theme editor with a LIVE preview (19 §7).
 *
 * The preview is the real `InvoicePrint` component fed sample data — not a mock-up — so
 * what the shopkeeper sees is literally what prints. That isomorphic-renderer rule is
 * the only honest basis for a WYSIWYG editor and kills a whole class of drift bugs
 * (plan 15 §1).
 *
 * Every control is a toggle, a dropdown or a short text box. There is no colour picker
 * and no CSS: the config can only hold closed enums, clamped numbers and plain text, so
 * a theme is structurally incapable of breaking GST compliance or carrying an injection.
 */
export function ThemeEditor({
  initialTheme,
  branding,
}: {
  initialTheme: BillTheme;
  branding: StoreBranding;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [theme, setTheme] = useState<BillTheme>(initialTheme);
  const [size, setSize] = useState<PrintSize>("a4");
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof BillTheme>(key: K, value: BillTheme[K]) =>
    setTheme((cur) => ({ ...cur, [key]: value }));

  function save() {
    startTransition(async () => {
      const res = await saveBillThemeAction(theme);
      if (res.ok) toast.success(t("billTheme.saved"));
      else toast.error(res.error ?? tc("errors.generic"));
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* ── Controls ── */}
      <div className="space-y-4">
        {/* Presets: never start from a blank form. */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("billTheme.presets")}
            </p>
            <div className="grid gap-2">
              {BILL_THEME_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setTheme(p.theme)}
                  className="rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("billTheme.look")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("billTheme.accent")}>
                <Select value={theme.accent} onChange={(e) => set("accent", e.target.value as BillTheme["accent"])}>
                  {BILL_ACCENTS.map((a) => (
                    <option key={a} value={a}>
                      {t(`billTheme.accentOption.${a}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t("billTheme.font")}>
                <Select
                  value={theme.fontFamily}
                  onChange={(e) => set("fontFamily", e.target.value as BillTheme["fontFamily"])}
                >
                  {BILL_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {t(`billTheme.fontOption.${f}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t("billTheme.size")}>
                <Input
                  type="number"
                  min={7}
                  max={14}
                  value={theme.baseSizePt}
                  onChange={(e) => set("baseSizePt", Number(e.target.value) || 10)}
                />
              </FormField>
              <FormField label={t("billTheme.density")}>
                <Select value={theme.density} onChange={(e) => set("density", e.target.value as BillTheme["density"])}>
                  {BILL_DENSITY.map((d) => (
                    <option key={d} value={d}>
                      {t(`billTheme.densityOption.${d}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t("billTheme.borders")}>
                <Select
                  value={theme.tableBorders}
                  onChange={(e) => set("tableBorders", e.target.value as BillTheme["tableBorders"])}
                >
                  {BILL_TABLE_BORDERS.map((b) => (
                    <option key={b} value={b}>
                      {t(`billTheme.bordersOption.${b}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t("billTheme.headerAlign")}>
                <Select
                  value={theme.headerAlign}
                  onChange={(e) => set("headerAlign", e.target.value as BillTheme["headerAlign"])}
                >
                  {BILL_ALIGN.map((a) => (
                    <option key={a} value={a}>
                      {t(`billTheme.alignOption.${a}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <div className="space-y-2">
              <Toggle label={t("billTheme.zebraRows")} checked={theme.zebraRows} onChange={(v) => set("zebraRows", v)} />
              <Toggle
                label={t("billTheme.outerBorder")}
                checked={theme.outerBorder}
                onChange={(v) => set("outerBorder", v)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("billTheme.show")}
            </p>
            <Toggle label={t("billTheme.showLogo")} checked={theme.showLogo} onChange={(v) => set("showLogo", v)} />
            <Toggle
              label={t("billTheme.showAddress")}
              checked={theme.showAddress}
              onChange={(v) => set("showAddress", v)}
            />
            <Toggle
              label={t("billTheme.showContact")}
              checked={theme.showContact}
              onChange={(v) => set("showContact", v)}
            />
            <Toggle
              label={t("billTheme.showHsnColumn")}
              checked={theme.showHsnColumn}
              onChange={(v) => set("showHsnColumn", v)}
            />
            <Toggle
              label={t("billTheme.showBankDetails")}
              checked={theme.showBankDetails}
              onChange={(v) => set("showBankDetails", v)}
            />
            <Toggle label={t("billTheme.showTerms")} checked={theme.showTerms} onChange={(v) => set("showTerms", v)} />
            <Toggle
              label={t("billTheme.showSignature")}
              checked={theme.showSignature}
              onChange={(v) => set("showSignature", v)}
            />
            <Toggle
              label={t("billTheme.showFooterNote")}
              checked={theme.showFooterNote}
              onChange={(v) => set("showFooterNote", v)}
            />
            <p className="pt-1 text-xs text-muted-foreground">{t("billTheme.lockedNote")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("billTheme.wording")}
            </p>
            <FormField label={t("billTheme.tagline")} hint={t("billTheme.tokensHint")}>
              <Input
                value={theme.tagline}
                maxLength={120}
                onChange={(e) => set("tagline", e.target.value)}
                placeholder={t("billTheme.taglinePlaceholder")}
              />
            </FormField>
            <FormField label={t("billTheme.signatureLabel")}>
              <Input
                value={theme.signatureLabel}
                maxLength={120}
                onChange={(e) => set("signatureLabel", e.target.value)}
              />
            </FormField>
            <FormField label={t("billTheme.footerNote")}>
              <Input value={theme.footerNote} maxLength={120} onChange={(e) => set("footerNote", e.target.value)} />
            </FormField>
          </CardContent>
        </Card>

        <div className="sticky bottom-0 flex gap-2 border-t bg-background/95 py-3 backdrop-blur">
          <Button onClick={save} disabled={pending} className="flex-1">
            {pending ? tc("actions.saving") : t("billTheme.save")}
          </Button>
          <Button variant="outline" onClick={() => setTheme(initialTheme)} disabled={pending}>
            {tc("actions.reset")}
          </Button>
        </div>
      </div>

      {/* ── Live preview: the real print component, with sample data ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("billTheme.preview")}
          </p>
          <Select
            value={size}
            onChange={(e) => setSize(e.target.value as PrintSize)}
            className="h-8 w-auto text-xs"
            aria-label={t("billTheme.paper")}
          >
            <option value="a4">A4</option>
            <option value="a5">A5</option>
            <option value="thermal3">80 mm</option>
            <option value="thermal2">58 mm</option>
          </Select>
        </div>
        {/* The preview must not be swept into window.print() — only the real receipt is. */}
        <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4 print:hidden">
          <div className="[&_[data-print-receipt]]:shadow-sm">
            <InvoicePrint
              invoice={SAMPLE_INVOICE}
              store={branding}
              size={size}
              lineLabels={SAMPLE_LINE_LABELS}
              theme={theme}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("billTheme.previewNote")}</p>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
