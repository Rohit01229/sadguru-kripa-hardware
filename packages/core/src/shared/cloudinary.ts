// Cloudinary delivery-URL helpers (pure, no deps). Product images are UPLOADED
// browser-side to Cloudinary via an unsigned preset (admin only); we persist the
// returned `secure_url` verbatim in Product.imageKeys. To serve a right-sized image
// we splice a transformation segment into the delivery URL — no re-upload, Cloudinary
// generates + caches the derived asset on first request.
//
// These are string transforms only: if the stored value isn't a Cloudinary
// `/image/upload/` URL (e.g. a legacy R2 key or an external URL), they return it
// unchanged, so callers can use them unconditionally.

const UPLOAD_MARKER = "/image/upload/";

/** Splice a Cloudinary transformation (e.g. "c_fill,w_400,h_400") into a delivery URL. */
export function cldUrl(url: string, transform: string): string {
  if (!url) return url;
  const i = url.indexOf(UPLOAD_MARKER);
  if (i === -1) return url; // not a Cloudinary upload URL — leave as-is
  const head = url.slice(0, i + UPLOAD_MARKER.length);
  const tail = url.slice(i + UPLOAD_MARKER.length);
  // Don't double-apply if a transform is already present right after /upload/.
  if (/^[a-z]_[^/]*\//.test(tail)) return url;
  return `${head}${transform}/${tail}`;
}

/** Square, cropped thumbnail for grids/lists (auto format + quality). */
export function cldThumb(url: string): string {
  return cldUrl(url, "c_fill,w_400,h_400,q_auto,f_auto");
}

/** Bounded large image for detail pages (never upscales; auto format + quality). */
export function cldDetail(url: string): string {
  return cldUrl(url, "c_limit,w_1200,h_1200,q_auto,f_auto");
}
