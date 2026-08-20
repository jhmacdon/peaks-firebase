"use client";

/**
 * Browser-only image downscale. Not unit-tested (needs `document`/canvas) —
 * the decision logic it delegates to (`computeDownscaleDimensions`,
 * `resolvedMimeType`) lives in `image-upload.ts` and is covered there.
 */

import {
  MAX_IMAGE_EDGE_PX,
  computeDownscaleDimensions,
  resolvedMimeType,
  type ImageFileMeta,
} from "./image-upload";

export interface DownscaleResult {
  blob: Blob;
  contentType: string;
}

/**
 * Downscale an image to at most `maxEdge` on its longest side, converting
 * to JPEG (PNG stays PNG, to keep transparency). Falls back to returning
 * the original file untouched whenever the canvas round-trip can't run:
 * the image is already small enough, or `createImageBitmap`/canvas decode
 * throws.
 *
 * That fallback is also how HEIC is handled. Chromium-based browsers have
 * no built-in HEIC decoder, so `createImageBitmap` reliably throws for a
 * HEIC file there and we upload the original — Safari's OS-level HEIC
 * decoder means the same code path actually downscales it successfully.
 * Either way the ≤10MB size cap in `validateImageFile` is the backstop for
 * whatever gets uploaded unscaled.
 */
export async function maybeDownscaleImage(
  file: File,
  maxEdge: number = MAX_IMAGE_EDGE_PX
): Promise<DownscaleResult> {
  const meta: ImageFileMeta = { type: file.type, size: file.size, name: file.name };
  const contentType = resolvedMimeType(meta) || file.type || "application/octet-stream";

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { blob: file, contentType };
  }

  try {
    const { width, height, scaled } = computeDownscaleDimensions(
      bitmap.width,
      bitmap.height,
      maxEdge
    );
    if (!scaled) {
      return { blob: file, contentType };
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const outputType = contentType === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, 0.88)
    );
    if (!blob) throw new Error("Canvas produced no image data");

    return { blob, contentType: blob.type || outputType };
  } catch {
    return { blob: file, contentType };
  } finally {
    bitmap.close();
  }
}
