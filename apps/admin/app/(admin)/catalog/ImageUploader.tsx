"use client";

import { useRef, useState } from "react";
import { cldThumb } from "@hardware/core";
import { Button, toast } from "@hardware/ui";

// Unsigned browser→Cloudinary uploader for product photos. The admin is staff-only
// and authenticated, so an UNSIGNED upload preset is acceptable: the browser POSTs
// the file straight to Cloudinary with the preset name (no server round-trip, no API
// secret in the bundle), and we keep the returned `secure_url` in controlled state.
// The parent decides how to persist: the create form emits hidden `imageKeys` inputs
// (pass `name`); the edit card calls a server action on save.
//
// Config comes from NEXT_PUBLIC_* env (inlined at build). When unset the widget
// renders a friendly "not configured" note instead of failing at upload time.

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
const CONFIGURED = Boolean(CLOUD_NAME && UPLOAD_PRESET);

const ACCEPT = "image/png,image/jpeg,image/webp,image/avif";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file — plenty for a product photo.

export function ImageUploader({
  value,
  onChange,
  name,
  max = 8,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  /** When set, emit a hidden input per URL so the URLs post with the parent form. */
  name?: string;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", UPLOAD_PRESET!);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { secure_url?: string };
    return json.secure_url ?? null;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!CONFIGURED) {
      toast.error("Cloudinary is not configured yet.");
      return;
    }
    const room = Math.max(0, max - value.length);
    if (room === 0) {
      toast.error(`You can add at most ${max} images.`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of picked) {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is larger than 10 MB — skipped.`);
          continue;
        }
        const url = await uploadOne(file);
        if (url) added.push(url);
        else toast.error(`Upload failed for ${file.name}.`);
      }
      if (added.length > 0) {
        onChange([...value, ...added]);
        toast.success(added.length === 1 ? "Image added." : `${added.length} images added.`);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {name && value.map((url, i) => <input key={`${url}-${i}`} type="hidden" name={name} value={url} />)}

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {value.map((url, i) => (
            <li
              key={`${url}-${i}`}
              className="group relative h-24 w-24 overflow-hidden rounded-md border bg-muted"
            >
              {/* Plain <img> (not next/image) so no remote-domain allowlist is needed;
                  cldThumb serves a right-sized, auto-format derivative. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cldThumb(url)}
                alt={`Product image ${i + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove image ${i + 1}`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
              >
                ×
              </button>
              {i === 0 && (
                <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-medium text-white">
                  Primary
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={!CONFIGURED || busy || value.length >= max}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          isLoading={busy}
          disabled={!CONFIGURED || value.length >= max}
          onClick={() => inputRef.current?.click()}
          className="min-h-[2.75rem] sm:min-h-0"
        >
          {busy ? "Uploading…" : value.length > 0 ? "Add more images" : "Upload images"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {value.length}/{max} · PNG/JPG/WebP, up to 10&nbsp;MB each. First image is the primary.
        </span>
      </div>

      {!CONFIGURED && (
        <p className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          Image uploads are disabled until Cloudinary is configured. Set{" "}
          <code>NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME</code> and{" "}
          <code>NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET</code> in <code>apps/admin/.env</code>, then
          restart the dev server.
        </p>
      )}
    </div>
  );
}
