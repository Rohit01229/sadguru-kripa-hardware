// Sentry server init (DSN-guarded). See apps/admin/instrumentation.ts for the
// rationale: skipped when SENTRY_DSN is unset; beforeSend runs every event through
// the tested core `redact` so PII / secrets never leave the process.
export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const Sentry = await import("@sentry/nextjs");
  const { redact } = await import("@hardware/core");

  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return redact(event) as typeof event;
    },
  });
}
