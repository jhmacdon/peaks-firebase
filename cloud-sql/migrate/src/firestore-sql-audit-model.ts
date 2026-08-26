export interface NormalizedPoint {
  sessionId: string;
  time: number;
  segmentNumber: number;
  lat: number;
  lng: number;
  elevation: number;
  speed: number | null;
  azimuth: number | null;
  hdop: number | null;
  speedAccuracy: number | null;
  geohash: string | null;
}

export interface NormalizedMarker {
  sessionId: string;
  lat: number;
  lng: number;
  elevation: number;
  name: string | null;
  image: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  )));
}

export function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = typeof value === "number"
    ? new Date(value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function nullableFiniteNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : finiteNumber(value);
}

export function normalizePoints(
  sessionId: string,
  value: unknown
): { points: NormalizedPoint[]; errors: string[]; duplicateCount: number } {
  if (!Array.isArray(value)) return { points: [], errors: [], duplicateCount: 0 };

  const points: NormalizedPoint[] = [];
  const errors: string[] = [];
  const seenTimes = new Set<number>();
  let duplicateCount = 0;

  value.forEach((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const time = finiteNumber(record.time);
    const lat = finiteNumber(record.lat);
    const lng = finiteNumber(record.lng);
    const elevation = finiteNumber(record.elevation);
    if (time === null || !Number.isSafeInteger(time) || time <= 0
        || lat === null || lng === null || elevation === null) {
      errors.push(`${sessionId}:point:${index}:invalid time/lat/lng/elevation`);
      return;
    }
    if (seenTimes.has(time)) {
      // Cloud SQL's primary key is (session_id, time). Keep the first legacy
      // Firestore sample at a repeated second, matching the old migrator's
      // INSERT order, and report the loss as a count rather than inventing time.
      duplicateCount++;
      return;
    }
    seenTimes.add(time);

    points.push({
      sessionId,
      time,
      segmentNumber: finiteNumber(record.segmentNumber) ?? 0,
      lat,
      lng,
      elevation,
      speed: nullableFiniteNumber(record.speed),
      azimuth: nullableFiniteNumber(record.azimuth),
      hdop: nullableFiniteNumber(record.hdop),
      speedAccuracy: nullableFiniteNumber(record.speedAccuracy),
      geohash: typeof record.geoHash === "string" ? record.geoHash : null,
    });
  });

  return { points, errors, duplicateCount };
}

export function normalizeMarkers(
  sessionId: string,
  value: unknown
): { markers: NormalizedMarker[]; errors: string[] } {
  if (!Array.isArray(value)) return { markers: [], errors: [] };

  const markers: NormalizedMarker[] = [];
  const errors: string[] = [];
  value.forEach((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const lat = finiteNumber(record.lat);
    const lng = finiteNumber(record.lng);
    const elevation = finiteNumber(record.elevation);
    const createdAt = toDate(record.created);
    if (lat === null || lng === null || elevation === null || createdAt === null) {
      errors.push(`${sessionId}:marker:${index}:invalid lat/lng/elevation/created`);
      return;
    }
    markers.push({
      sessionId,
      lat,
      lng,
      elevation,
      name: typeof record.name === "string" ? record.name : null,
      image: typeof record.image === "string" ? record.image : null,
      createdBy: typeof record.createdBy === "string" ? record.createdBy : null,
      createdAt,
    });
  });
  return { markers, errors };
}

function signaturePart(value: string | null): string {
  return value ?? "";
}

export function markerSignature(marker: NormalizedMarker): string {
  return [
    marker.sessionId,
    marker.lat.toFixed(7),
    marker.lng.toFixed(7),
    marker.elevation.toFixed(3),
    signaturePart(marker.name),
    signaturePart(marker.image),
    signaturePart(marker.createdBy),
    marker.createdAt.toISOString(),
  ].join("|");
}

export function missingMultisetItems<T>(
  source: T[],
  targetSignatures: string[],
  signature: (item: T) => string
): T[] {
  const available = new Map<string, number>();
  for (const key of targetSignatures) {
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  return source.filter((item) => {
    const key = signature(item);
    const count = available.get(key) ?? 0;
    if (count === 0) return true;
    available.set(key, count - 1);
    return false;
  });
}
