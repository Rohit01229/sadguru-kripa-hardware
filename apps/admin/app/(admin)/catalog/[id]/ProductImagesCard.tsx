"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from "@hardware/ui";
import { ImageUploader } from "../ImageUploader";
import { setProductImagesAction } from "../actions";

// Edit-page image manager. Uploads go straight to Cloudinary (ImageUploader); the
// resulting URL list is held in local state and persisted with an explicit Save so
// a mis-click doesn't immediately rewrite the product. `dirty` compares against the
// server list so Save only enables after a real change.

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function ProductImagesCard({
  productId,
  initial,
}: {
  productId: string;
  initial: string[];
}) {
  const [images, setImages] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const [pending, startTransition] = useTransition();
  const dirty = !sameList(images, saved);

  function save() {
    startTransition(async () => {
      const res = await setProductImagesAction(productId, images);
      if (res.ok) {
        setSaved(images);
        toast.success("Images saved.");
      } else {
        toast.error(res.error ?? "Could not save images.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-sm">Images</CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload product photos. The first image is the primary shown in the catalog and storefront.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ImageUploader value={images} onChange={setImages} />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={save}
            isLoading={pending}
            disabled={!dirty}
            className="min-h-[2.75rem] sm:min-h-0"
          >
            Save images
          </Button>
          {dirty && !pending && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
