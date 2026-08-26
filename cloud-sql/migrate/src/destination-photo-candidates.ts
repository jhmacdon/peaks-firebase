import crypto from "node:crypto";

const MIN_PHOTO_WIDTH = 900;
const MIN_PHOTO_HEIGHT = 500;

export interface DestinationPhotoManifestCandidate {
  destinationId: string;
  destinationName: string;
  imageUrl: string;
  sourcePageUrl: string;
  sourceKind: string;
  photographer: string;
  licenseName: string;
  licenseUrl: string;
  imageWidth: number;
  imageHeight: number;
  focalX: number;
  focalY: number;
  notes?: string;
}

export interface DestinationPhotoManifest {
  collection: string;
  researchedAt: string;
  candidates: DestinationPhotoManifestCandidate[];
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function httpsUrl(value: unknown, path: string): string {
  const text = requiredString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${path} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${path} must use HTTPS`);
  }
  return parsed.toString();
}

function positiveInt(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${path} must be a positive whole number`);
  }
  return Number(value);
}

function minimumDimension(value: unknown, path: string, minimum: number): number {
  const parsed = positiveInt(value, path);
  if (parsed < minimum) {
    throw new Error(`${path} must be at least ${minimum}`);
  }
  return parsed;
}

function percentInt(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) {
    throw new Error(`${path} must be a whole number from 0 to 100`);
  }
  return Number(value);
}

export function deterministicPhotoCandidateId(
  destinationId: string,
  sourcePageUrl: string
): string {
  return crypto
    .createHash("sha256")
    .update(`destination-photo:${destinationId}:${sourcePageUrl}`)
    .digest("base64url")
    .slice(0, 20);
}

export function parseDestinationPhotoManifest(value: unknown): DestinationPhotoManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("photo manifest must be an object");
  }
  const record = value as Record<string, unknown>;
  const collection = requiredString(record.collection, "collection");
  const researchedAt = requiredString(record.researchedAt, "researchedAt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(researchedAt)) {
    throw new Error("researchedAt must use YYYY-MM-DD");
  }
  if (!Array.isArray(record.candidates) || record.candidates.length === 0) {
    throw new Error("candidates must be a non-empty array");
  }

  const seenSources = new Set<string>();
  const candidates = record.candidates.map((raw, index) => {
    const path = `candidates[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${path} must be an object`);
    }
    const candidate = raw as Record<string, unknown>;
    const destinationId = requiredString(candidate.destinationId, `${path}.destinationId`);
    const destinationName = requiredString(candidate.destinationName, `${path}.destinationName`);
    const sourcePageUrl = httpsUrl(candidate.sourcePageUrl, `${path}.sourcePageUrl`);
    const sourceKey = `${destinationId}\n${sourcePageUrl}`;
    if (seenSources.has(sourceKey)) {
      throw new Error(`${path}.sourcePageUrl repeats for ${destinationName}`);
    }
    seenSources.add(sourceKey);

    const notes = candidate.notes == null
      ? undefined
      : requiredString(candidate.notes, `${path}.notes`);
    return {
      destinationId,
      destinationName,
      imageUrl: httpsUrl(candidate.imageUrl, `${path}.imageUrl`),
      sourcePageUrl,
      sourceKind: requiredString(candidate.sourceKind, `${path}.sourceKind`),
      photographer: requiredString(candidate.photographer, `${path}.photographer`),
      licenseName: requiredString(candidate.licenseName, `${path}.licenseName`),
      licenseUrl: httpsUrl(candidate.licenseUrl, `${path}.licenseUrl`),
      imageWidth: minimumDimension(
        candidate.imageWidth,
        `${path}.imageWidth`,
        MIN_PHOTO_WIDTH
      ),
      imageHeight: minimumDimension(
        candidate.imageHeight,
        `${path}.imageHeight`,
        MIN_PHOTO_HEIGHT
      ),
      focalX: percentInt(candidate.focalX, `${path}.focalX`),
      focalY: percentInt(candidate.focalY, `${path}.focalY`),
      ...(notes ? { notes } : {}),
    };
  });

  return { collection, researchedAt, candidates };
}
