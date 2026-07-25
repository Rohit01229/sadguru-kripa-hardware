"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from "@hardware/ui";

interface JobResult {
  id: string;
  status: string;
  totalRows: number;
  createdRows: number;
  errorRows: number;
  errors: { row: number; message: string; issues?: { path: string; issue: string }[] }[];
}

// CSV import client: POST multipart to /api/import/catalog (→ 202 + jobId), then
// GET /api/import/jobs/{id} for the row-level report.
export function ImportClient() {
  const t = useTranslations("catalog");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobResult | null>(null);

  function chooseFile(f: File | null) {
    setError(null);
    setJob(null);
    setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      // Reflect the dropped file into the native input so the existing FormData flow is unchanged.
      const dt = new DataTransfer();
      dt.items.add(dropped);
      if (inputRef.current) inputRef.current.files = dt.files;
      chooseFile(dropped);
    }
  }

  async function runImport() {
    if (!file || file.size === 0) {
      setError(t("import.chooseFirst"));
      return;
    }
    setError(null);
    setJob(null);
    const fd = new FormData();
    fd.set("file", file);
    setBusy(true);
    try {
      const res = await fetch("/api/import/catalog", { method: "POST", body: fd });
      const body = await res.json();
      if (res.status !== 202) {
        const message = body?.error?.message ?? t("import.uploadFailed");
        setError(message);
        toast.error(message);
        return;
      }
      const jobRes = await fetch(`/api/import/jobs/${body.jobId}`);
      const jobBody = (await jobRes.json()) as JobResult;
      setJob(jobBody);
      if (jobBody.errorRows > 0) {
        toast.error(t("import.toastImportedErrors", { count: jobBody.errorRows }));
      } else {
        toast.success(t("import.toastImported", { count: jobBody.createdRows }));
      }
    } catch {
      setError(t("import.networkError"));
      toast.error(t("import.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-sm font-medium">
          {file ? file.name : t("import.dropHere")}
        </p>
        <p className="text-xs text-muted-foreground">
          {file
            ? t("import.readyToImport", { size: (file.size / 1024).toFixed(1) })
            : t("import.orChoose")}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {file ? t("import.chooseDifferent") : t("import.chooseFile")}
          </Button>
          <Button type="button" size="sm" isLoading={busy} onClick={runImport} disabled={!file}>
            {t("import.uploadImport")}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {busy && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("import.processing")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-52" />
          </CardContent>
        </Card>
      )}

      {job && !busy && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">{t("import.result")}</CardTitle>
            {job.errorRows > 0 ? (
              <Badge variant="warning">{t("import.errorRowsBadge", { count: job.errorRows })}</Badge>
            ) : (
              <Badge variant="success">{t("import.success")}</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t("import.statTotalRows")} value={job.totalRows} />
              <Stat label={t("import.statCreated")} value={job.createdRows} />
              <Stat label={t("import.statErrors")} value={job.errorRows} tone={job.errorRows > 0 ? "destructive" : undefined} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t.rich("import.jobLine", {
                id: job.id,
                status: job.status,
                mono: (chunks) => <span className="font-mono">{chunks}</span>,
              })}
            </p>

            {job.errors.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead numeric className="w-16">{t("import.colRow")}</TableHead>
                      <TableHead>{t("import.colProblem")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {job.errors.map((er, i) => (
                      <TableRow key={i}>
                        <TableCell numeric className="align-top font-mono">{er.row}</TableCell>
                        <TableCell>
                          {er.message}
                          {er.issues && (
                            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                              {er.issues.map((iss, j) => (
                                <li key={j}>
                                  <span className="font-mono">{iss.path}</span>: {iss.issue}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive";
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
