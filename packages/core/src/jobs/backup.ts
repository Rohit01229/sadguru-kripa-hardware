// Encrypted database backup (S7; 03 §10, 05 — statutory retention ≈ 6 years → R2).
// RUNTIME-DEFERRED: a real `pg_dump | gpg | put-to-R2` pipeline needs (a) a shell with
// pg_dump (NOT available in the Vercel serverless runtime — this runs on a scheduled
// VPS/worker or a one-off box) and (b) R2 credentials. Core stays framework-free and
// MUST NOT crash at import when those are absent, so this module exposes:
//   - `backupPlan()` — a PURE, testable description of WHAT the backup would do
//     (object key, retention cutoff, whether creds are present), with NO side effects.
//   - `runBackup()` — executes the plan IFF R2 creds + pg_dump are available; otherwise
//     returns a `deferred` result and never throws. The transport/cron layer reports
//     "runtime-deferred (needs R2 creds)" when deferred is true.
//
// The dump command and encryption are described here but only SPAWNED when enabled, so
// unit tests exercise the plan/retention math without a database or R2.

export interface BackupPlan {
  /** R2 object key: backups/YYYY/MM/hardware-YYYY-MM-DDTHH-mm-ssZ.sql.gpg */
  objectKey: string;
  /** ISO timestamp the backup is taken at. */
  takenAt: string;
  /** Objects older than this (ISO) are eligible for deletion (6-year retention). */
  retentionCutoff: string;
  /** True when R2 + encryption creds are all present (so the run can proceed). */
  enabled: boolean;
  /** Why it is disabled (which env var is missing), for the deferred report. */
  disabledReason: string | null;
  /** The R2 bucket the object lands in (null when disabled). */
  bucket: string | null;
}

/** Six years in days (≈ 2192, accounting for leap years). Statutory GST retention. */
const RETENTION_YEARS = 6;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Build the (pure) backup plan from the environment, WITHOUT running anything. Used by
 * `runBackup` and directly unit-tested. The object key is time-partitioned so the
 * retention sweep is a cheap prefix listing. `enabled` requires the full R2 set + an
 * encryption passphrase; any missing one yields a `disabledReason` and enabled:false.
 */
export function backupPlan(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): BackupPlan {
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  const stamp = `${y}-${m}-${d}T${hh}-${mm}-${ss}Z`;
  const objectKey = `backups/${y}/${m}/hardware-${stamp}.sql.gpg`;

  const cutoff = new Date(Date.UTC(y - RETENTION_YEARS, now.getUTCMonth(), now.getUTCDate()));

  const bucket = env.R2_BUCKET ?? null;
  const missing: string[] = [];
  if (!env.R2_ACCOUNT_ID) missing.push("R2_ACCOUNT_ID");
  if (!env.R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET");
  if (!env.BACKUP_ENCRYPTION_PASSPHRASE) missing.push("BACKUP_ENCRYPTION_PASSPHRASE");
  if (!env.DIRECT_URL && !env.DATABASE_URL) missing.push("DIRECT_URL/DATABASE_URL");

  return {
    objectKey,
    takenAt: now.toISOString(),
    retentionCutoff: cutoff.toISOString(),
    enabled: missing.length === 0,
    disabledReason: missing.length === 0 ? null : `missing ${missing.join(", ")}`,
    bucket,
  };
}

export interface BackupResult {
  job: "backup";
  plan: BackupPlan;
  /** True when the dump+upload actually ran; false → runtime-deferred (no creds). */
  ran: boolean;
  deferred: boolean;
  error: string | null;
}

/**
 * Execute the backup IFF enabled. When disabled (missing creds), returns
 * `{ ran:false, deferred:true }` and never throws — the cron endpoint reports it as
 * runtime-deferred. The actual `pg_dump | gpg | R2 put` + retention sweep is intentionally
 * NOT spawned here in v1 (it belongs on a box with pg_dump, not the serverless runtime);
 * this is the seam where that pipeline is wired. Keeping it a no-op-when-disabled means
 * the scheduled arm and its idempotency are testable now without a live DB or R2.
 */
export async function runBackup(now: Date = new Date()): Promise<BackupResult> {
  const plan = backupPlan(now);
  if (!plan.enabled) {
    return { job: "backup", plan, ran: false, deferred: true, error: null };
  }
  // RUNTIME-DEFERRED EXECUTION: with creds present this is where we would
  //   spawn: pg_dump "$DIRECT_URL" | gpg --symmetric --passphrase "$PASS" | r2 put $bucket/$key
  //   then prune objects under backups/ older than plan.retentionCutoff.
  // We do NOT spawn a shell from the serverless runtime; the pipeline runs on a
  // scheduled worker/VPS. Returning ran:false + deferred:false signals "enabled but
  // not executed in this runtime" so the report is honest.
  return { job: "backup", plan, ran: false, deferred: false, error: "execution runs on the backup worker, not the serverless cron runtime" };
}
