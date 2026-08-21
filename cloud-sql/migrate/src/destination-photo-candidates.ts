import crypto from "node:crypto";

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

export interface DestinationPhotoManifestHold {
  destinationId: string;
  destinationName: string;
  reason: string;
}

export interface DestinationPhotoManifest {
  collection: string;
  researchedAt: string;
  candidates: DestinationPhotoManifestCandidate[];
  held: DestinationPhotoManifestHold[];
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
      imageWidth: positiveInt(candidate.imageWidth, `${path}.imageWidth`),
      imageHeight: positiveInt(candidate.imageHeight, `${path}.imageHeight`),
      focalX: percentInt(candidate.focalX, `${path}.focalX`),
      focalY: percentInt(candidate.focalY, `${path}.focalY`),
      ...(notes ? { notes } : {}),
    };
  });

  const rawHeld = record.held == null ? [] : record.held;
  if (!Array.isArray(rawHeld)) {
    throw new Error("held must be an array");
  }
  const candidateDestinationIds = new Set(candidates.map((candidate) => candidate.destinationId));
  const heldDestinationIds = new Set<string>();
  const held = rawHeld.map((raw, index) => {
    const path = `held[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${path} must be an object`);
    }
    const item = raw as Record<string, unknown>;
    const destinationId = requiredString(item.destinationId, `${path}.destinationId`);
    const destinationName = requiredString(item.destinationName, `${path}.destinationName`);
    if (candidateDestinationIds.has(destinationId)) {
      throw new Error(`${path}.destinationId also has a candidate: ${destinationName}`);
    }
    if (heldDestinationIds.has(destinationId)) {
      throw new Error(`${path}.destinationId repeats: ${destinationName}`);
    }
    heldDestinationIds.add(destinationId);
    return {
      destinationId,
      destinationName,
      reason: requiredString(item.reason, `${path}.reason`),
    };
  });

  return { collection, researchedAt, candidates, held };
}
