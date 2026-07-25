// R2 (S3-compatible) signed-URL helper (S7 security finishing; 07 §8). Product images
// and invoice PDFs are stored in Cloudflare R2 by object key (Product.imageKeys,
// StoreConfig.logoKey, backups/*). To serve a private object we mint a TIME-LIMITED
// presigned GET URL (SigV4) so the bucket stays private and links expire.
//
// PURE, framework-free, and BUNDLER-PORTABLE: signing uses Web Crypto
// (`globalThis.crypto.subtle`), available in Node 22 and the Edge runtime alike — NO
// top-level `node:crypto` import (a `node:` import reachable from core's exported
// surface breaks the Next/webpack build; see orders/razorpay.ts + shared/idempotency.ts
// for the same rule). SigV4 chains 4 HMACs, so signing is async.
//
// RUNTIME-DEFERRED: when R2 creds are empty (dev/CI), `isR2Configured()` is false and
// `signGetUrl` resolves to null — callers fall back to a placeholder rather than
// crashing at import or build.

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Read R2 config from the environment; null when any required var is empty. */
export function getR2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isR2Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getR2Config(env) !== null;
}

// ─────────────────── Web Crypto primitives (bundler-portable) ───────────────────
function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return globalThis.crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(digest);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
/** AWS basic-ISO8601 (YYYYMMDDТHHMMSSZ) + date (YYYYMMDD) for SigV4. */
function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const y = now.getUTCFullYear();
  const mo = pad2(now.getUTCMonth() + 1);
  const d = pad2(now.getUTCDate());
  const h = pad2(now.getUTCHours());
  const mi = pad2(now.getUTCMinutes());
  const s = pad2(now.getUTCSeconds());
  return { amzDate: `${y}${mo}${d}T${h}${mi}${s}Z`, dateStamp: `${y}${mo}${d}` };
}

/** Encode a path segment per AWS (RFC-3986, but keep "/" between segments). */
function uriEncodeKey(key: string): string {
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()),
    )
    .join("/");
}

const REGION = "auto"; // Cloudflare R2 uses region "auto".
const SERVICE = "s3";

/**
 * Mint a presigned GET URL for an R2 object key, valid for `expiresInSeconds`
 * (default 5 min). Resolves to null when R2 is not configured (runtime-deferred —
 * caller uses a placeholder). PURE: SigV4 query-signing via Web Crypto, no network
 * call. The endpoint is the R2 S3 API host `<accountId>.r2.cloudflarestorage.com`.
 */
export async function signGetUrl(
  objectKey: string,
  expiresInSeconds = 300,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const cfg = getR2Config(env);
  if (!cfg) return null;

  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const { amzDate, dateStamp } = amzDates(now);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${cfg.bucket}/${uriEncodeKey(objectKey)}`;

  const expires = Math.max(1, Math.min(expiresInSeconds, 604800)); // 1s..7d (SigV4 cap)
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(new TextEncoder().encode(`AWS4${cfg.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, SERVICE);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
