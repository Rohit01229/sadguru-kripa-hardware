"use client";

import { useState } from "react";
import { cldDetail, cldThumb } from "@hardware/core";

// Storefront product gallery: a large primary image with a thumbnail strip that
// swaps the active image on click. Images are Cloudinary URLs stored on the product;
// cldDetail/cldThumb serve right-sized derivatives. Renders a neutral placeholder
// when the product has no photos yet.

export function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)]!;

  return (
    <div className="space-y-3">
      <div className="aspect-square w-full overflow-hidden rounded-lg border bg-muted">
        <img src={cldDetail(current)} alt={alt} className="h-full w-full object-contain" />
      </div>
      {images.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((url, i) => (
            <li key={`${url}-${i}`}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`View image ${i + 1}`}
                aria-current={i === active}
                className={`h-16 w-16 overflow-hidden rounded-md border transition ${
                  i === active ? "ring-2 ring-primary ring-offset-1" : "opacity-80 hover:opacity-100"
                }`}
              >
                <img src={cldThumb(url)} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
