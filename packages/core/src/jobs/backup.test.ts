import { describe, it, expect } from "vitest";
import { backupPlan, runBackup } from "./backup";

// S7 backup-plan unit tests (03 §10; 05 retention). PURE plan/retention math — no DB,
// no R2 spawn. Asserts the time-partitioned object key, the 6-year retention cutoff,
// and the graceful-degradation contract (disabled + reason when creds are missing).

const FULL_ENV = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "akid",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "hardware-backups",
  BACKUP_ENCRYPTION_PASSPHRASE: "pass",
  DIRECT_URL: "postgres://x",
} as unknown as NodeJS.ProcessEnv;

describe("jobs.backupPlan", () => {
  it("builds a time-partitioned, encrypted object key", () => {
    const plan = backupPlan(new Date("2026-06-29T03:15:42Z"), FULL_ENV);
    expect(plan.objectKey).toBe("backups/2026/06/hardware-2026-06-29T03-15-42Z.sql.gpg");
    expect(plan.bucket).toBe("hardware-backups");
    expect(plan.enabled).toBe(true);
    expect(plan.disabledReason).toBeNull();
  });

  it("sets a 6-year retention cutoff", () => {
    const plan = backupPlan(new Date("2026-06-29T00:00:00Z"), FULL_ENV);
    expect(plan.retentionCutoff.slice(0, 4)).toBe("2020");
  });

  it("is DISABLED with a reason when R2 creds are missing (no crash)", () => {
    const plan = backupPlan(new Date("2026-06-29T00:00:00Z"), {} as NodeJS.ProcessEnv);
    expect(plan.enabled).toBe(false);
    expect(plan.disabledReason).toContain("R2_ACCOUNT_ID");
    expect(plan.disabledReason).toContain("BACKUP_ENCRYPTION_PASSPHRASE");
  });

  it("names the missing var when only one is absent", () => {
    const env = { ...FULL_ENV };
    delete (env as Record<string, unknown>).BACKUP_ENCRYPTION_PASSPHRASE;
    const plan = backupPlan(new Date("2026-06-29T00:00:00Z"), env);
    expect(plan.enabled).toBe(false);
    expect(plan.disabledReason).toBe("missing BACKUP_ENCRYPTION_PASSPHRASE");
  });
});

describe("jobs.runBackup — deferred when disabled, never throws", () => {
  it("returns deferred:true without creds (runtime-deferred)", async () => {
    // The ambient process.env in CI/dev has no R2 creds → deferred.
    const res = await runBackup(new Date("2026-06-29T00:00:00Z"));
    expect(res.job).toBe("backup");
    if (!res.plan.enabled) {
      expect(res.deferred).toBe(true);
      expect(res.ran).toBe(false);
    }
  });
});
