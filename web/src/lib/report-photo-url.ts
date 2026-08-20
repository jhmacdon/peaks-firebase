type FirebaseWebAppConfig = {
  storageBucket?: unknown;
};

function normalizedBucketName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bucket = value.trim().replace(/^gs:\/\//i, "").toLowerCase();
  if (
    bucket.length < 3 ||
    bucket.length > 222 ||
    !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(bucket)
  ) {
    return null;
  }
  return bucket;
}

function bucketFromConfig(rawConfig: string | undefined): string | null {
  if (!rawConfig) return null;
  try {
    const config = JSON.parse(rawConfig) as FirebaseWebAppConfig;
    return normalizedBucketName(config.storageBucket);
  } catch {
    return null;
  }
}

function configuredStorageBucket(): string | null {
  return (
    normalizedBucketName(process.env.FIREBASE_STORAGE_BUCKET) ??
    normalizedBucketName(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) ??
    bucketFromConfig(process.env.FIREBASE_WEBAPP_CONFIG) ??
    bucketFromConfig(process.env.NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG)
  );
}

function decodedPathPart(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function firebaseStorageLocation(
  url: URL
): { bucket: string; objectPath: string } | null {
  const parts = url.pathname.split("/");

  if (url.hostname === "firebasestorage.googleapis.com") {
    if (
      parts.length < 6 ||
      parts[1] !== "v0" ||
      parts[2] !== "b" ||
      parts[4] !== "o"
    ) {
      return null;
    }
    const bucket = decodedPathPart(parts[3]);
    const objectPath = decodedPathPart(parts.slice(5).join("/"));
    return bucket && objectPath ? { bucket, objectPath } : null;
  }

  if (url.hostname !== "storage.googleapis.com") return null;

  if (
    parts.length >= 8 &&
    parts[1] === "download" &&
    parts[2] === "storage" &&
    parts[3] === "v1" &&
    parts[4] === "b" &&
    parts[6] === "o"
  ) {
    const bucket = decodedPathPart(parts[5]);
    const objectPath = decodedPathPart(parts.slice(7).join("/"));
    return bucket && objectPath ? { bucket, objectPath } : null;
  }

  const bucket = decodedPathPart(parts[1]);
  const objectPath = decodedPathPart(parts.slice(2).join("/"));
  return bucket && objectPath ? { bucket, objectPath } : null;
}

export interface NormalizedReportPhoto {
  /** Canonical HTTPS download URL — safe to render and store as-is. */
  url: string;
  /** The bucket object path (e.g. `trip-reports/uid/sessionId/abc123`) —
   * what `trip_report_photos.storage_path` stores, and what
   * `trip_report_photo_deletions` needs to actually delete the object
   * later. */
  storagePath: string;
}

/**
 * Validate + decompose a photo URL, but only when it points at the
 * configured Peaks Firebase Storage bucket. Null means the URL must not be
 * rendered or stored — used both to sanitize what the report detail page
 * renders and to gate what `trip-reports.ts` persists to
 * `trip_report_photos`.
 */
export function normalizeReportPhoto(value: unknown): NormalizedReportPhoto | null {
  if (typeof value !== "string") return null;
  const configuredBucket = configuredStorageBucket();
  if (!configuredBucket) return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }

  const location = firebaseStorageLocation(url);
  if (
    !location ||
    location.bucket.toLowerCase() !== configuredBucket
  ) {
    return null;
  }

  return { url: url.toString(), storagePath: location.objectPath };
}

/**
 * Return a canonical HTTPS URL only when it points at the configured Peaks
 * Firebase Storage bucket. Null means the URL must not be rendered or stored.
 */
export function normalizeReportPhotoUrl(value: unknown): string | null {
  return normalizeReportPhoto(value)?.url ?? null;
}
