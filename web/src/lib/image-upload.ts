/**
 * Pure validation + downscale-decision helpers for client-side image
 * uploads (avatar, trip-report photos). No DOM/canvas access here — that
 * lives in `image-downscale.ts` — so this module runs under `node --test`.
 */

/** The subset of `File` these helpers actually need, so tests can pass a
 * plain object instead of a real browser `File`. */
export interface ImageFileMeta {
  type: string;
  size: number;
  name?: string;
}

export interface UploadLimits {
  maxBytes: number;
  acceptedMimeTypes: readonly string[];
  /** Human-readable format list for copy/error text, e.g. "JPG or PNG". */
  label: string;
}

export const AVATAR_UPLOAD_LIMITS: UploadLimits = {
  maxBytes: 5 * 1024 * 1024,
  acceptedMimeTypes: ["image/jpeg", "image/png"],
  label: "JPG or PNG",
};

export const REPORT_PHOTO_UPLOAD_LIMITS: UploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  label: "JPG, PNG, WEBP, or HEIC",
};

const HEIC_EXTENSION_PATTERN = /\.(heic|heif)$/i;

/**
 * Browsers frequently fail to set a MIME type for HEIC/HEIF files — Safari
 * on iOS in particular often reports an empty `file.type` for photos
 * straight off the camera roll. Fall back to the file extension so a real
 * HEIC photo isn't rejected just because the browser didn't label it.
 *
 * Also normalizes an explicitly-reported `image/heif` to `image/heic` —
 * `REPORT_PHOTO_UPLOAD_LIMITS.acceptedMimeTypes` only lists the latter, but
 * the file input's `accept` attribute invites both, and some browsers/OSes
 * do report `image/heif` for what's functionally the same HEIF-family
 * format as `.heic`.
 */
export function resolvedMimeType(file: ImageFileMeta): string {
  const reported = file.type ? file.type.toLowerCase() : "";
  if (reported === "image/heif") return "image/heic";
  if (reported) return reported;
  if (file.name && HEIC_EXTENSION_PATTERN.test(file.name)) return "image/heic";
  return "";
}

export type ImageValidationResult = { ok: true } | { ok: false; error: string };

/** Client-side validation only — a trust boundary, not a security control.
 * The upload still goes through Firebase Storage rules (contentType +
 * size) on the server side. */
export function validateImageFile(
  file: ImageFileMeta,
  limits: UploadLimits
): ImageValidationResult {
  const type = resolvedMimeType(file);
  if (!limits.acceptedMimeTypes.includes(type)) {
    return { ok: false, error: `Please choose a ${limits.label} image.` };
  }
  if (file.size <= 0) {
    return { ok: false, error: "That file looks empty. Choose another image." };
  }
  if (file.size > limits.maxBytes) {
    const maxMb = Math.round(limits.maxBytes / (1024 * 1024));
    return { ok: false, error: `Image is too large. Max size is ${maxMb}MB.` };
  }
  return { ok: true };
}

export const MAX_IMAGE_EDGE_PX = 2048;

export interface DownscaleDimensions {
  width: number;
  height: number;
  /** False when the image is already within `maxEdge` — caller should skip
   * the canvas round-trip entirely and upload the original bytes. */
  scaled: boolean;
}

/**
 * Pure geometry for the canvas downscale: given a source image's pixel
 * dimensions, decide whether it needs shrinking and to what size,
 * preserving aspect ratio. The longest edge is capped at `maxEdge`.
 */
export function computeDownscaleDimensions(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE_PX
): DownscaleDimensions {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(maxEdge) ||
    maxEdge <= 0
  ) {
    return { width, height, scaled: false };
  }

  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return { width, height, scaled: false };
  }

  const scale = maxEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}
