// Structured JSON logger with redaction (08 §1). Never log secrets or full PII.
const SENSITIVE_KEYS = [
  "password",
  "passwordhash",
  "token",
  "tokenhash",
  "secret",
  "authorization",
  "cookie",
  "gstin",
  "phone",
  "email",
  "card",
  "cvv",
  "otp",
  "recoverycodes",
];

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

export type LogFields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}): Logger {
  function emit(level: Level, msg: string, fields?: LogFields): void {
    const line = JSON.stringify({
      level,
      msg,
      time: new Date().toISOString(),
      ...base,
      ...(fields ? (redact(fields) as LogFields) : {}),
    });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  }
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (f) => createLogger({ ...base, ...f }),
  };
}
