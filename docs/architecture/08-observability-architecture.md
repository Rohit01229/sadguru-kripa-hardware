# Observability Architecture

**Status:** DRAFT · 2026-06-24
How we see what the app is doing — logs, errors, metrics, uptime, and alerts — so the shop keeps running and the owner is told when something needs attention.

## Scope & posture

A single hardware store can't afford a war-room or a 24/7 on-call rota. Observability here is **lean, mostly free-tier, and biased toward actionable alerts** over dashboards nobody watches. We lean on managed signals already in the stack (see `01-tech-stack.md`): **structured app logs**, **Sentry** for errors, **Vercel analytics** for traffic, **UptimeRobot** for external uptime, and **Upstash/Vercel Cron** job status.

Two principles:
- **Few, high-signal alerts.** Every alert must map to "the owner or the developer should *do* something." Noise gets muted, not ignored.
- **Logs are diagnostics, not the system of record.** The money's source of truth is the database and the **audit/void log** (a business record — see `07-security-architecture.md` §10). Application logs are ephemeral and **must never hold secrets or full PII** (§ below).

The split that matters most: **system health** (is the app up and correct?) vs **business health** (is the shop OK — stock, payments, dues?). We alert on both, through different channels.

---

## 1. Logging

**Format.** **Structured JSON logs** to stdout (the platform collects them — Vercel log drains, or the VPS log pipeline; see `05-infrastructure-architecture.md`). One event per line, machine-parseable. Use a small logger wrapper in `@hardware/core` so both apps log identically.

**Correlation.** Every inbound request gets a **request/correlation ID** (generate or accept an upstream `x-request-id`), attached to every log line for that request and propagated into background jobs and Sentry events. This lets us trace one customer action across server action → DB → webhook without full distributed tracing yet.

**Log levels.**

| Level | Use for |
|-------|---------|
| `error` | Unhandled failures, failed payments to apply, webhook signature failures, job failures. |
| `warn` | Degraded-but-handled: retries, near-limit conditions, recovered errors. |
| `info` | Lifecycle: request start/finish, order placed, job started/completed, deploy. |
| `debug` | Verbose dev detail; **off in production** by default. |

**What to log:** correlation ID, route/action name, user **id** (not PII), order/invoice **id**, outcome + duration, error class + stack (to Sentry), job name + result.

**What NOT to log — ever:** card/UPI data (we never receive it anyway — §4 of `07`), passwords or password hashes, session tokens/cookies, Auth.js/Razorpay/R2 secrets, OTP/2FA codes, full reset tokens, and **full PII** (phone, email, full address, GSTIN). Redact or reference by id. A redaction helper in the logger strips known sensitive keys (`password`, `token`, `secret`, `authorization`, `cookie`, `gstin`, `phone`, `email`, `card`, `cvv`, etc.) as a backstop, so a careless `log.info(req.body)` can't leak. Where a value is genuinely needed for support, log a **masked** form (e.g. last 4 of a phone) rather than the full value.

**Volume control.** Default to one structured line per request plus explicit business events; avoid per-iteration `debug` in hot paths. This keeps us inside free-tier log limits and keeps the signal-to-noise ratio high for the times we actually grep the logs by correlation ID.

---

## 2. Error tracking (Sentry)

**Sentry across both apps** (`apps/admin` and `apps/storefront`), free tier. It captures unhandled exceptions and explicitly-reported errors with stack traces, request context, and the correlation ID.

- **Release tracking.** Tag every event with the **release/version** (Git SHA) so we know which deploy introduced a regression; wire release creation into the GitHub Actions deploy step.
- **Source maps.** Upload source maps at build so production stack traces are **readable** (and **not** shipped to the browser).
- **PII scrubbing.** Enable Sentry's data-scrubbing and add server-side `beforeSend` redaction so the same "never log" list (§1) applies to error payloads. Sample sensibly to stay in free-tier limits.
- **Environments.** Separate `development` / `staging` / `production` so dev noise never pages anyone.

---

## 3. Metrics

**Traffic / web vitals.** **Vercel Analytics** (or the VPS equivalent) covers page views, latency, and Core Web Vitals for the storefront — enough for a shop-scale app without a metrics stack.

**Key business metrics.** A handful, surfaced on a simple admin dashboard and computed from the database (not from logs):

| Metric | Definition | Why it matters |
|--------|-----------|----------------|
| **Sales / day** | Count + ₹ value of pakka sales (and kacha *count/value* only if the owner permits the aggregate — see `07` §11). | Daily pulse; day-end reconciliation. |
| **Payment success rate** | Razorpay captured ÷ attempted (online orders). | A drop signals a gateway/integration problem. |
| **Low-stock count** | SKUs at/below reorder level. | Drives reordering; feeds a business alert. |
| **Reservation-expiry rate** | Reserved web carts that expired vs converted. | High rate = checkout friction or oversell pressure (`03-review-and-gaps.md` P0-4). |

Quantified targets (latency, availability) live in `09-nfr.md`; this doc defines *what we observe*, not the SLOs.

---

## 4. Uptime monitoring

**UptimeRobot** (free) probes public endpoints from outside the platform and alerts on downtime — the check that still fires when the app itself is too broken to alert.

- Add a lightweight **`/healthz`** endpoint to **both apps** (liveness: process up, returns 200 quickly; no auth, no PII, cheap).
- Add **`/readyz`** (readiness: verifies it can reach Postgres/Neon, briefly) for a deeper check — UptimeRobot hits `/healthz` frequently and `/readyz` less often to avoid load and connection churn.
- Monitor the **production domain** and the **storefront checkout path** availability. Probe interval per UptimeRobot free tier (~5 min).

---

## 5. Alerting

Alerts are split by audience and channel. **System alerts** go to the **developer/maintainer**; **business alerts** go to the **owner** in plain language (no stack traces). Channels: email now; **WhatsApp/SMS** (via MSG91) as the business channel matures (it carries cost + DLT lead time — `03-review-and-gaps.md` P1-12). Final channel routing **TBD**.

**System alerts (developer):**
- **Error-rate spike** — Sentry error volume/regression threshold crossed.
- **Downtime** — UptimeRobot reports the site/health-check down.
- **Failed cron / queue job** — a Vercel Cron run or Upstash QStash job fails or stops reporting (day-end, reservation-expiry, reminders).
- **DB connection issues** — Neon pool exhaustion / connection errors / `/readyz` failing.

**Business alerts (owner):**
- **Low stock** — SKU at/below reorder level (digest, not per-event spam).
- **Near-expiry** — batches/products nearing expiry where tracked.
- **Payment failures** — repeated online payment failures, or the success rate dropping below a floor.
- **Large khata overdue** — a customer's outstanding credit exceeds a threshold or ages past N days.

Each alert specifies trigger, channel, and (where useful) a quiet-hours/digest rule so the owner isn't pinged at 2 a.m. for a single low-stock SKU.

**Starting thresholds (tune after go-live — values are assumptions, not SLOs; see `09-nfr.md`):**

| Alert | Starting trigger | Cadence |
|-------|------------------|---------|
| Error-rate spike | Sentry error volume > baseline × N, or any new release-tagged error class | Real-time |
| Downtime | `/healthz` non-200 on consecutive probes | Real-time |
| Failed cron/queue job | Any failure, or a scheduled run that didn't report | Real-time |
| DB connection issues | Pool-exhaustion / connect errors, or `/readyz` failing | Real-time |
| Payment failures | Success rate < ~90% over a rolling window, or ≥ 3 consecutive failures | Near-real-time |
| Low stock | Any SKU ≤ reorder level | Daily digest |
| Near-expiry | Batch within N days of expiry | Daily digest |
| Large khata overdue | Outstanding > ₹ threshold **or** aged > N days | Daily digest |

**On-alert expectation.** For a solo build, "on-call" is the developer's inbox. The minimum response: open the linked Sentry issue or UptimeRobot incident, check the affected release, and either roll back the deploy or open a fix. A short incident runbook (rollback steps, Neon status, Razorpay status page) lives in `05-infrastructure-architecture.md` (**TBD**).

---

## 6. Audit/void log vs application logs

These are **different things** and must not be conflated:

| | **Audit / void log** | **Application logs** |
|---|---|---|
| Nature | **Business record** — tamper-evident | Diagnostic / operational telemetry |
| Stored in | **The database** (append-only) | Platform log stream (Sentry for errors) |
| Contents | Who voided/cancelled an invoice, issued a credit note, edited a rate, adjusted khata — with before/after | Requests, errors, timings, job results |
| Retention | ≥ life of the related records (statutory) | Short (§8) |
| Deletable | **No** — integrity guarantee | Yes — rotated/expired |
| Owner | Security/compliance (`07-security-architecture.md` §10) | Observability (this doc) |

In short: if it's *money or compliance*, it's an **audit-log** entry in the DB and governed by `07`. If it's *operational health*, it's an **application log/metric/alert** and governed here. The audit log can also *emit* a system alert (e.g. a burst of voids), but the record itself lives in the DB, not the log stream.

---

## 7. Health-check endpoints

| Endpoint | Type | Checks | Auth |
|----------|------|--------|------|
| `/healthz` | Liveness | Process up, returns 200 fast | None |
| `/readyz` | Readiness | Can reach Postgres/Neon (and critical deps) | None |

Both return minimal JSON (`{ "status": "ok" }`), **no PII, no secrets, no version detail to anonymous callers** beyond a coarse status. Used by UptimeRobot (§4) and by the platform/load-balancer where applicable (`05`).

---

## 8. Log retention

- **Application logs:** **30–90 days** (exact value **TBD**, bounded by free-tier limits) — long enough to investigate an incident, short enough to be cheap and to limit PII exposure window.
- **Sentry events:** per free-tier retention (~30–90 days).
- **Audit/void log & statutory records:** **not** governed here — retained ~6 years per GST (`07-security-architecture.md` §3).
- Logs are purged automatically at end of window; nothing sensitive should be in them to begin with (§1).

---

## 9. Tracing (later)

Full distributed tracing is **deferred**. The **correlation/request ID** (§1) gives us cross-component request stitching that's sufficient at shop scale. When traffic or complexity grows (or a module is extracted — see `00-overview.md` scale-later path), add **OpenTelemetry** instrumentation exporting to a managed backend, reusing the same correlation IDs. Marked **TBD / later addition**.

---

## 10. Signals → tool → channel (summary)

| Signal | Captured by | Alert channel | Audience |
|--------|-------------|---------------|----------|
| Unhandled exception / error spike | Sentry | Email (→ later WhatsApp/SMS) | Developer |
| Site / health-check down | UptimeRobot (`/healthz`) | Email + UptimeRobot push | Developer |
| Failed cron / queue job | Vercel Cron / Upstash QStash + app logs | Email | Developer |
| DB connection issues | App logs / `/readyz` / Sentry | Email | Developer |
| Request/latency, web vitals | Vercel Analytics | Dashboard (no page) | Developer |
| Sales/day, payment success rate | DB (admin dashboard) | Dashboard + daily digest | Owner |
| Low stock | DB | Owner digest (email/WhatsApp) | Owner |
| Near-expiry | DB | Owner digest | Owner |
| Payment failures (online) | App logs + Razorpay webhooks + Sentry | Email/WhatsApp | Owner + Developer |
| Large khata overdue | DB | Owner alert | Owner |
| Void / credit-note / rate edit | **Audit log (DB)** — see `07` | (optional) system alert on bursts | Owner + Developer |

---

## 11. Deliberately out of scope (for now)

To keep the shop's running cost near zero and the ops burden tiny, we intentionally **do not** run at v1: a self-hosted metrics/dashboard stack (Prometheus/Grafana), centralized log aggregation beyond the platform's drains, full distributed tracing (§9), synthetic transaction monitoring beyond UptimeRobot's path check, or a paid APM. Each is a clear later addition tied to growth — same incremental philosophy as the scale-later path in `00-overview.md`. Adding any of them should reuse the **correlation ID** so existing signals stay coherent.

---

### Cross-references
- `07-security-architecture.md` — audit/void log (business record), log redaction rules, secrets.
- `05-infrastructure-architecture.md` — log drains, cron/queue setup, environments, backups.
- `09-nfr.md` — quantified availability/latency targets the metrics here measure against.
- `06-network-architecture.md` — rate limiting and edge that health checks sit behind.
- `03-review-and-gaps.md` — reservation-expiry, payment-reconciliation, and notification-cost context.
