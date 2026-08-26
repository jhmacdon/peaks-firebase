import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import "./firebase-admin";

const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_INPUT_PIXELS = 80_000_000;
const MIN_SOURCE_WIDTH = 900;
const MIN_SOURCE_HEIGHT = 600;
const MAX_OUTPUT_EDGE = 2_400;

export class DestinationPhotoSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DestinationPhotoSourceError";
  }
}

export interface StoredDestinationPhoto {
  url: string;
  width: number;
  height: number;
  bytes: number;
  bucketName: string;
  objectName: string;
}

export interface RenderedDestinationPhoto {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
}

export interface DestinationPhotoToStore {
  id: string;
  destinationId: string;
  imageUrl: string;
  sourcePageUrl: string;
  photographer: string;
  licenseName: string;
  licenseUrl: string;
  focalX: number;
  focalY: number;
}

function isPrivateIp(hostname: string): boolean {
  hostname = hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) === 4) {
    const [a, b] = hostname.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(hostname) === 6) {
    const value = hostname.toLowerCase();
    return (
      value.startsWith("::") ||
      value.startsWith("fe") ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("ff")
    );
  }
  return false;
}

export function assertRemoteImageUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new DestinationPhotoSourceError("Photo source must use HTTPS");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateIp(hostname)
  ) {
    throw new DestinationPhotoSourceError("Photo source must be a public host");
  }
  return url;
}

function firebaseWebConfigBucket(): string | null {
  const raw = process.env.FIREBASE_WEBAPP_CONFIG;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { storageBucket?: unknown };
    return typeof parsed.storageBucket === "string" ? parsed.storageBucket : null;
  } catch {
    return null;
  }
}

function storageBucketName(): string {
  const name =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    firebaseWebConfigBucket();
  if (!name) {
    throw new Error("Firebase Storage bucket is not configured");
  }
  return name.replace(/^gs:\/\//, "");
}

async function downloadSourceImage(rawUrl: string): Promise<Buffer> {
  let url = assertRemoteImageUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "Peaks destination photo reviewer/1.0" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) {
        throw new DestinationPhotoSourceError(
          "Photo source returned a redirect without a location"
        );
      }
      if (redirects === 5) {
        throw new DestinationPhotoSourceError("Photo source redirected too many times");
      }
      url = assertRemoteImageUrl(new URL(location, url).toString());
    }
    if (!response?.ok) {
      throw new DestinationPhotoSourceError(
        `Photo download failed with HTTP ${response?.status || "unknown"}`
      );
    }

    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      throw new DestinationPhotoSourceError("Photo source did not return an image");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_SOURCE_BYTES) {
      throw new DestinationPhotoSourceError("Photo source is larger than 40 MB");
    }

    if (!response.body) {
      throw new DestinationPhotoSourceError("Photo source returned an empty response");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) {
        await reader.cancel();
        throw new DestinationPhotoSourceError("Photo source is larger than 40 MB");
      }
      chunks.push(Buffer.from(value));
    }
    if (bytes === 0) {
      throw new DestinationPhotoSourceError("Photo source is empty");
    }
    return Buffer.concat(chunks, bytes);
  } catch (error) {
    if (error instanceof DestinationPhotoSourceError) throw error;
    if (controller.signal.aborted) {
      throw new DestinationPhotoSourceError("Photo download timed out");
    }
    throw new DestinationPhotoSourceError("Could not download the source photo");
  } finally {
    clearTimeout(timeout);
  }
}

export async function renderDestinationPhoto(
  input: Buffer
): Promise<RenderedDestinationPhoto> {
  const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
  const metadata = await source.metadata();
  const swapsAxes = metadata.orientation != null && metadata.orientation >= 5;
  const width = swapsAxes ? metadata.height || 0 : metadata.width || 0;
  const height = swapsAxes ? metadata.width || 0 : metadata.height || 0;
  if (width < MIN_SOURCE_WIDTH || height < MIN_SOURCE_HEIGHT) {
    throw new DestinationPhotoSourceError(
      `Photo is ${width}×${height}; covers must be at least ${MIN_SOURCE_WIDTH}×${MIN_SOURCE_HEIGHT}`
    );
  }
  const output = await source
    .rotate()
    .resize({
      width: MAX_OUTPUT_EDGE,
      height: MAX_OUTPUT_EDGE,
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
}

export async function storeDestinationPhoto(
  photo: DestinationPhotoToStore
): Promise<StoredDestinationPhoto> {
  const input = await downloadSourceImage(photo.imageUrl);
  const output = await renderDestinationPhoto(input);
  const downloadToken = randomUUID();
  const objectName = `destination-covers/${photo.destinationId}/${photo.id}-${downloadToken}.jpg`;
  const bucketName = storageBucketName();
  const file = getStorage().bucket(bucketName).file(objectName);
  await file.save(output.data, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: {
      cacheControl: "public,max-age=31536000,immutable",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        sourcePageUrl: photo.sourcePageUrl,
        photographer: photo.photographer,
        licenseName: photo.licenseName,
        licenseUrl: photo.licenseUrl,
        focalX: String(photo.focalX),
        focalY: String(photo.focalY),
        cropMode: "focal-point",
      },
    },
  });

  const url =
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}` +
    `/o/${encodeURIComponent(objectName)}?alt=media&token=${downloadToken}`;
  return {
    url,
    width: output.width,
    height: output.height,
    bytes: output.bytes,
    bucketName,
    objectName,
  };
}

export async function deleteStoredDestinationPhoto(
  photo: Pick<StoredDestinationPhoto, "bucketName" | "objectName">
): Promise<void> {
  try {
    await getStorage().bucket(photo.bucketName).file(photo.objectName).delete();
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
}
