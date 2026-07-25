// Sentry server init (08 §, 14-impl-plan Chunk 5 §4). DSN-guarded: if SENTRY_DSN
// is unset (dev), init is skipped and the app runs normally. `beforeSend` runs
// every event through the tested core `redact` so PII / secrets never leave the
// process (defence in depth — the logger already redacts at the source).
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
