"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { EwayAssessment, EwayBillDTO } from "@hardware/core";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormField,
  Input,
  Label,
  Select,
  StateCodePicker,
  formatMoney,
  formatDate,
  toast,
} from "@hardware/ui";
import { saveEwayDraftAction, recordEwayNumberAction, cancelEwayAction } from "./actions";

/**
 * e-Way bill panel on an invoice (doc 20 §7).
 *
 * We do not call the government API — that needs GSP credentials and IP whitelisting.
 * So the honest flow is: tell the shopkeeper whether a bill is needed, collect exactly
 * what the portal asks for, hand them a ready-made upload file, and record the number
 * that comes back. That removes the re-typing without pretending to be an integration.
 */
export function EwayBillCard({
  invoiceId,
  assessment,
  validityDays,
}: {
  invoiceId: string;
  assessment: EwayAssessment;
  /** Days the current distance would be valid for — shown live so it isn't a surprise. */
  validityDays: number;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const existing: EwayBillDTO | null = assessment.existing;
  const [open, setOpen] = useState(Boolean(existing));

  const [form, setForm] = useState({
    fromPincode: existing?.fromPincode ?? "",
    toPincode: existing?.toPincode ?? "",
    fromStateCode: existing?.fromStateCode ?? "",
    toStateCode: existing?.toStateCode ?? "",
    distanceKm: existing?.distanceKm != null ? String(existing.distanceKm) : "",
    transportMode: existing?.transportMode ?? "ROAD",
    vehicleNumber: existing?.vehicleNumber ?? "",
    overDimensional: existing?.overDimensional ?? false,
    transporterGstin: existing?.transporterGstin ?? "",
    transporterName: existing?.transporterName ?? "",
    transportDocNo: existing?.transportDocNo ?? "",
  });
  const [ewbNo, setEwbNo] = useState(existing?.ewbNo ?? "");

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const generated = existing?.status === "GENERATED";
  const cancelled = existing?.status === "CANCELLED";

  function save() {
    startTransition(async () => {
      const res = await saveEwayDraftAction(invoiceId, {
        ...form,
        distanceKm: form.distanceKm ? Number(form.distanceKm) : null,
        transportDocDate: null,
      });
      if (res.ok) toast.success(t("eway.saved"));
      else toast.error(res.error ?? tc("errors.generic"));
    });
  }

  function record() {
    startTransition(async () => {
      const res = await recordEwayNumberAction(invoiceId, ewbNo);
      if (res.ok) toast.success(t("eway.recorded"));
      else toast.error(res.error ?? tc("errors.generic"));
    });
  }

  function cancel() {
    startTransition(async () => {
      const res = await cancelEwayAction(invoiceId, "OTHERS");
      if (res.ok) toast.success(t("eway.cancelled"));
      else toast.error(res.error ?? tc("errors.generic"));
    });
  }

  // Nothing needed and nothing started — one quiet line, not a whole card.
  if (!assessment.decision.required && !existing) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("eway.notRequired", {
          threshold: formatMoney(assessment.decision.thresholdPaise),
        })}{" "}
        <button type="button" onClick={() => setOpen(true)} className="underline hover:text-foreground">
          {t("eway.createAnyway")}
        </button>
      </p>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t("eway.heading")}</h3>
            {generated && <Badge variant="success">{existing?.ewbNo}</Badge>}
            {cancelled && <Badge variant="destructive">{t("eway.statusCancelled")}</Badge>}
            {!existing && assessment.decision.required && (
              <Badge variant="outline">{t("eway.statusRequired")}</Badge>
            )}
          </div>
          {generated && existing?.validUntil && (
            <span className="text-xs text-muted-foreground">
              {t("eway.validUntil", { date: formatDate(existing.validUntil) })}
            </span>
          )}
        </div>

        {assessment.decision.required && !existing && (
          <Alert>
            {t("eway.requiredNote", {
              value: formatMoney(assessment.consignmentValue),
              threshold: formatMoney(assessment.decision.thresholdPaise),
              kind: assessment.decision.interState ? t("eway.interState") : t("eway.intraState"),
            })}
          </Alert>
        )}

        {assessment.documentTooOld && <Alert variant="destructive">{t("eway.tooOld")}</Alert>}
        {assessment.problems.map((p) => (
          <Alert key={p} variant="destructive">
            {p}
          </Alert>
        ))}

        {open && !cancelled && (
          <>
            {/* ── Part-A: the consignment ── */}
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("eway.partA")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("eway.fromState")}>
                <StateCodePicker
                  value={form.fromStateCode}
                  onChange={(e) => set("fromStateCode", e.target.value)}
                  disabled={generated}
                />
              </FormField>
              <FormField label={t("eway.fromPincode")}>
                <Input
                  value={form.fromPincode}
                  onChange={(e) => set("fromPincode", e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  disabled={generated}
                />
              </FormField>
              <FormField label={t("eway.toState")}>
                <StateCodePicker
                  value={form.toStateCode}
                  onChange={(e) => set("toStateCode", e.target.value)}
                  disabled={generated}
                />
              </FormField>
              <FormField label={t("eway.toPincode")}>
                <Input
                  value={form.toPincode}
                  onChange={(e) => set("toPincode", e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  disabled={generated}
                />
              </FormField>
              <FormField
                label={t("eway.distance")}
                hint={form.distanceKm ? t("eway.validityHint", { days: validityDays }) : undefined}
              >
                <Input
                  value={form.distanceKm}
                  onChange={(e) => set("distanceKm", e.target.value)}
                  type="number"
                  min={0}
                  max={4000}
                  inputMode="numeric"
                  disabled={generated}
                />
              </FormField>
            </div>

            {/* ── Part-B: the vehicle (may come later) ── */}
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("eway.partB")}
            </p>
            <p className="-mt-2 text-xs text-muted-foreground">{t("eway.partBNote")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("eway.mode")}>
                <Select
                  value={form.transportMode}
                  onChange={(e) => set("transportMode", e.target.value as typeof form.transportMode)}
                  disabled={generated}
                >
                  <option value="ROAD">{t("eway.modeRoad")}</option>
                  <option value="RAIL">{t("eway.modeRail")}</option>
                  <option value="AIR">{t("eway.modeAir")}</option>
                  <option value="SHIP">{t("eway.modeShip")}</option>
                </Select>
              </FormField>
              <FormField label={t("eway.vehicle")} hint={t("eway.vehicleHint")}>
                <Input
                  value={form.vehicleNumber}
                  onChange={(e) => set("vehicleNumber", e.target.value.toUpperCase())}
                  placeholder="WB12AB1234"
                  disabled={generated}
                />
              </FormField>
              <FormField label={t("eway.transporterName")}>
                <Input
                  value={form.transporterName}
                  onChange={(e) => set("transporterName", e.target.value)}
                  disabled={generated}
                />
              </FormField>
              <FormField label={t("eway.transporterGstin")}>
                <Input
                  value={form.transporterGstin}
                  onChange={(e) => set("transporterGstin", e.target.value.toUpperCase())}
                  disabled={generated}
                />
              </FormField>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.overDimensional}
                onChange={(e) => set("overDimensional", e.target.checked)}
                disabled={generated}
              />
              {t("eway.overDimensional")}
            </label>

            {!generated && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={save} disabled={pending}>
                  {t("eway.saveDetails")}
                </Button>
                {existing && (
                  <Button variant="outline" asChild>
                    <a href={`/api/billing/invoices/${invoiceId}/eway.json`} download>
                      {t("eway.downloadJson")}
                    </a>
                  </Button>
                )}
              </div>
            )}

            {/* ── Record the number the portal issued ── */}
            {existing && !generated && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <Label htmlFor="ewbNo">{t("eway.recordHeading")}</Label>
                <p className="text-xs text-muted-foreground">{t("eway.recordNote")}</p>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="ewbNo"
                    value={ewbNo}
                    onChange={(e) => setEwbNo(e.target.value.replace(/\D/g, ""))}
                    placeholder="121000123456"
                    inputMode="numeric"
                    maxLength={12}
                    className="w-48"
                  />
                  <Button variant="outline" onClick={record} disabled={pending || ewbNo.length !== 12}>
                    {t("eway.saveNumber")}
                  </Button>
                </div>
              </div>
            )}

            {generated && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <a href={`/api/billing/invoices/${invoiceId}/eway.json`} download>
                    {t("eway.downloadJson")}
                  </a>
                </Button>
                <Button variant="destructive" onClick={cancel} disabled={pending}>
                  {t("eway.cancel")}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
