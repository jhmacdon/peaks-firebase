import { randomUUID } from "node:crypto";
import admin from "firebase-admin";
import sharp from "sharp";

/**
 * Admin cover photos: the image checks and Storage I/O behind
 * PUT /api/admin/{routes|destinations}/:id/cover.
 *
 * The client uploads the original to `covers/{kind}/{id}/{file}` (storage.rules
 * allows that only for the `admin` custom claim). The API reads it back, checks
 * it, and writes a processed JPEG next to the reviewed covers, the same way the
 * web review flow does (web/src/lib/destination-photo-storage.ts): auto-rotated,
 * at most 2400 px on the long edge, quality 86, served by a Firebase download
 * token URL.
 */

export type CoverKind = "routes" | "destinations";

/** Matches storage.rules: uploads must be under 15 MiB. */
export const COVER_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
/** Same floor as the web review flow (web/src/lib/destination-photo-quality.ts). */
export const COVER_MIN_WIDTH = 1_600;
export const COVER_MIN_HEIGHT = 900;
/**
 * The web flow allows 80 MP. Cloud Run gives this API 512 MiB, and a decoded
 * 80 MP image needs about 240 MB, so the API stops at 50 MP (a 48 MP phone
 * photo still fits).
 */
export const COVER_MAX_INPUT_PIXELS = 50_000_000;
export const COVER_MAX_OUTPUT_EDGE = 2_400;

/**
 * Formats the prebuilt sharp can decode. Its libvips has no HEVC decoder, so
 * HEIC/HEIF always fails; clients export JPEG.
 */
export const COVER_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const DECODED_FORMATS = new Set(["jpeg", "png", "webp"]);

// No cache, one libvips thread. These do not serialize requests: see
// withCoverProcessingLock below.
sharp.cache(false);
sharp.concurrency(1);

let processingTail: Promise<unknown> = Promise.resolve();

/**
 * Runs one cover download-and-decode at a time per process. Cloud Run sends
 * up to four requests to an instance with 512 MiB; two 50 MP decodes at once
 * would not fit.
 */
export function withCoverProcessingLock<T>(work: () => Promise<T>): Promise<T> {
  const run = processingTail.then(work, work);
  processingTail = run.catch(() => undefined);
  return run;
}

/** A problem with the request or the uploaded object; `status` is the HTTP code. */
export class CoverPhotoError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CoverPhotoError";
  }
}

export function coverUploadPrefix(kind: CoverKind, id: string): string {
  return `covers/${kind}/${id}/`;
}

const UPLOAD_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** The object the client uploaded, which must sit directly under its prefix. */
export function validateUploadPath(kind: CoverKind, id: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new CoverPhotoError(400, "storagePath is required");
  }
  const prefix = coverUploadPrefix(kind, id);
  const fileName = value.slice(prefix.length);
  if (!value.startsWith(prefix) || !UPLOAD_FILE_NAME.test(fileName) || fileName.includes("..")) {
    throw new CoverPhotoError(400, `storagePath must be a file directly under ${prefix}`);
  }
  return value;
}

/** Where the processed copy lives: next to the web flow's reviewed covers. */
export function processedCoverObjectName(kind: CoverKind, id: string, token: string): string {
  const folder = kind === "routes" ? "route-covers" : "destination-covers";
  return `${folder}/${id}/admin-${randomUUID()}-${token}.jpg`;
}

export function coverDownloadUrl(bucketName: string, objectName: string, token: string): string {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}` +
    `/o/${encodeURIComponent(objectName)}?alt=media&token=${token}`
  );
}

export interface RenderedCover {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
}

export async function renderCoverPhoto(input: Buffer): Promise<RenderedCover> {
  let width: number;
  let height: number;
  const source = sharp(input, { limitInputPixels: COVER_MAX_INPUT_PIXELS, failOn: "error" });
  try {
    const metadata = await source.metadata();
    if (!metadata.format || !DECODED_FORMATS.has(metadata.format)) {
      throw new CoverPhotoError(415, "Covers must be JPEG, PNG or WebP");
    }
    const swapsAxes = metadata.orientation != null && metadata.orientation >= 5;
    width = (swapsAxes ? metadata.height : metadata.width) || 0;
    height = (swapsAxes ? metadata.width : metadata.height) || 0;
  } catch (error) {
    if (error instanceof CoverPhotoError) throw error;
    throw new CoverPhotoError(422, "Uploaded file is not a readable image");
  }
  if (width * height > COVER_MAX_INPUT_PIXELS) {
    throw new CoverPhotoError(422, `Photo is larger than ${COVER_MAX_INPUT_PIXELS / 1_000_000} megapixels`);
  }
  if (width < COVER_MIN_WIDTH || height < COVER_MIN_HEIGHT) {
    throw new CoverPhotoError(
      422,
      `Photo is ${width}×${height}; covers must be at least ${COVER_MIN_WIDTH}×${COVER_MIN_HEIGHT}`
    );
  }
  try {
    const output = await source
      .rotate()
      .resize({
        width: COVER_MAX_OUTPUT_EDGE,
        height: COVER_MAX_OUTPUT_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 86, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      data: output.data,
      width: output.info.width,
      height: output.info.height,
      bytes: output.info.size,
    };
  } catch {
    throw new CoverPhotoError(422, "Uploaded file is not a readable image");
  }
}

export interface StoredObjectInfo {
  contentType: string | null;
  size: number;
  /** Object generation, so the download reads exactly what was checked. */
  generation: string | null;
}

/** The Storage operations the admin cover endpoints need; swapped out in tests. */
export interface CoverStorage {
  readonly bucketName: string;
  stat(objectName: string): Promise<StoredObjectInfo | null>;
  download(objectName: string, generation: string | null): Promise<Buffer>;
  save(objectName: string, data: Buffer, token: string, metadata: Record<string, string>): Promise<void>;
  /** With a generation, removes only that version (a newer upload survives). */
  remove(objectName: string, generation?: string | null): Promise<void>;
}

export function firebaseCoverStorage(): CoverStorage {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.replace(/^gs:\/\//, "");
  if (!bucketName) throw new Error("FIREBASE_STORAGE_BUCKET is not configured");
  const bucket = admin.storage().bucket(bucketName);
  return {
    bucketName,
    async stat(objectName) {
      try {
        const [metadata] = await bucket.file(objectName).getMetadata();
        return {
          contentType: typeof metadata.contentType === "string" ? metadata.contentType : null,
          size: Number(metadata.size ?? 0),
          generation: metadata.generation == null ? null : String(metadata.generation),
        };
      } catch (error) {
        if ((error as { code?: number }).code === 404) return null;
        throw error;
      }
    },
    async download(objectName, generation) {
      const file = generation
        ? bucket.file(objectName, { generation: Number(generation) })
        : bucket.file(objectName);
      try {
        const [data] = await file.download();
        return data;
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code === 404 || code === 412) {
          throw new CoverPhotoError(422, "Uploaded image changed or vanished; upload it again");
        }
        throw error;
      }
    },
    async save(objectName, data, token, metadata) {
      await bucket.file(objectName).save(data, {
        resumable: false,
        contentType: "image/jpeg",
        metadata: {
          cacheControl: "public,max-age=31536000,immutable",
          metadata: { firebaseStorageDownloadTokens: token, ...metadata },
        },
      });
    },
    async remove(objectName, generation) {
      try {
        await bucket.file(objectName).delete({
          ignoreNotFound: true,
          ...(generation ? { ifGenerationMatch: Number(generation) } : {}),
        });
      } catch (error) {
        // 412: a newer upload replaced this one; leave it.
        if ((error as { code?: number }).code !== 412) throw error;
      }
    },
  };
}

/**
 * Checks and processes one upload, then stores the processed copy. Returns the
 * upload's generation so the caller removes exactly that version. A refused
 * upload is removed here: originals can carry EXIF GPS, and nothing else
 * would ever clean them up.
 */
export async function storeAdminCover(
  storage: CoverStorage,
  kind: CoverKind,
  id: string,
  uploadPath: string,
  metadata: Record<string, string>
): Promise<{ objectName: string; url: string; width: number; height: number; uploadGeneration: string | null }> {
  const info = await storage.stat(uploadPath);
  if (!info) throw new CoverPhotoError(422, "Uploaded image not found at storagePath");
  try {
    const contentType = info.contentType?.toLowerCase().split(";")[0].trim() ?? "";
    if (!(COVER_UPLOAD_TYPES as readonly string[]).includes(contentType)) {
      throw new CoverPhotoError(415, "Covers must be JPEG, PNG or WebP (image/jpeg, image/png, image/webp)");
    }
    if (info.size <= 0) throw new CoverPhotoError(422, "Uploaded image is empty");
    if (info.size > COVER_UPLOAD_MAX_BYTES) {
      throw new CoverPhotoError(422, "Uploaded image is larger than 15 MB");
    }
    const rendered = await withCoverProcessingLock(async () => {
      const input = await storage.download(uploadPath, info.generation);
      if (input.byteLength > COVER_UPLOAD_MAX_BYTES) {
        throw new CoverPhotoError(422, "Uploaded image is larger than 15 MB");
      }
      return renderCoverPhoto(input);
    });
    const token = randomUUID();
    const objectName = processedCoverObjectName(kind, id, token);
    await storage.save(objectName, rendered.data, token, {
      ...metadata,
      sourcePath: uploadPath,
      cropMode: "focal-point",
    });
    return {
      objectName,
      url: coverDownloadUrl(storage.bucketName, objectName, token),
      width: rendered.width,
      height: rendered.height,
      uploadGeneration: info.generation,
    };
  } catch (error) {
    if (error instanceof CoverPhotoError) {
      try {
        await storage.remove(uploadPath, info.generation);
      } catch (cleanup) {
        console.warn("[admin-cover] could not remove refused upload", uploadPath, (cleanup as Error).message);
      }
    }
    throw error;
  }
}
