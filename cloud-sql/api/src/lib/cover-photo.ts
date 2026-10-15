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

// One decode at a time, no cache: keeps peak memory to one image per request.
sharp.cache(false);
sharp.concurrency(1);

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
    const swapsAxes = metadata.orientation != null && metadata.orientation >= 5;
    width = (swapsAxes ? metadata.height : metadata.width) || 0;
    height = (swapsAxes ? metadata.width : metadata.height) || 0;
  } catch {
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
}

/** The Storage operations the admin cover endpoints need; swapped out in tests. */
export interface CoverStorage {
  readonly bucketName: string;
  stat(objectName: string): Promise<StoredObjectInfo | null>;
  download(objectName: string): Promise<Buffer>;
  save(objectName: string, data: Buffer, token: string, metadata: Record<string, string>): Promise<void>;
  remove(objectName: string): Promise<void>;
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
        };
      } catch (error) {
        if ((error as { code?: number }).code === 404) return null;
        throw error;
      }
    },
    async download(objectName) {
      const [data] = await bucket.file(objectName).download();
      return data;
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
    async remove(objectName) {
      await bucket.file(objectName).delete({ ignoreNotFound: true });
    },
  };
}

/** Checks and processes one upload, then stores the processed copy. */
export async function storeAdminCover(
  storage: CoverStorage,
  kind: CoverKind,
  id: string,
  uploadPath: string,
  metadata: Record<string, string>
): Promise<{ objectName: string; url: string; width: number; height: number }> {
  const info = await storage.stat(uploadPath);
  if (!info) throw new CoverPhotoError(422, "Uploaded image not found at storagePath");
  if (!info.contentType || !/^image\//i.test(info.contentType)) {
    throw new CoverPhotoError(422, "Uploaded file must have an image/* content type");
  }
  if (info.size <= 0) throw new CoverPhotoError(422, "Uploaded image is empty");
  if (info.size > COVER_UPLOAD_MAX_BYTES) {
    throw new CoverPhotoError(422, "Uploaded image is larger than 15 MB");
  }
  const input = await storage.download(uploadPath);
  if (input.byteLength > COVER_UPLOAD_MAX_BYTES) {
    throw new CoverPhotoError(422, "Uploaded image is larger than 15 MB");
  }
  const rendered = await renderCoverPhoto(input);
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
  };
}
