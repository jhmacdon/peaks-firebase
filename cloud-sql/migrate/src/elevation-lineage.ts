export interface PersistedElevationLineage {
  elevation_source: string | null;
  elevation_source_url: string | null;
  elevation_attribution: string | null;
  elevation_license_url: string | null;
  elevation_retrieved_at: Date | string | null;
}

export type PublicElevationLineage = {
  elevation_source?: unknown;
  elevation_source_url?: unknown;
  elevation_attribution?: unknown;
  elevation_license_url?: unknown;
  elevation_retrieved_at?: unknown;
};

const LINEAGE_FIELDS = [
  "elevation_source",
  "elevation_source_url",
  "elevation_attribution",
  "elevation_license_url",
  "elevation_retrieved_at",
] as const;

function timestampIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function timestampsMatch(
  persisted: Date | string | null,
  exposed: unknown
): boolean {
  if (persisted === null) return exposed === null;
  if (exposed === null || exposed === undefined) return false;
  const persistedIso = timestampIso(persisted);
  const exposedIso = timestampIso(exposed);
  return (
    persistedIso !== null &&
    exposedIso !== null &&
    persistedIso === exposedIso
  );
}

export function publicElevationLineageMatches(
  persisted: PersistedElevationLineage,
  exposed: PublicElevationLineage
): boolean {
  if (
    !LINEAGE_FIELDS.every((field) =>
      Object.prototype.hasOwnProperty.call(exposed, field)
    )
  ) {
    return false;
  }
  return (
    exposed.elevation_source === persisted.elevation_source &&
    exposed.elevation_source_url === persisted.elevation_source_url &&
    exposed.elevation_attribution === persisted.elevation_attribution &&
    exposed.elevation_license_url === persisted.elevation_license_url &&
    timestampsMatch(
      persisted.elevation_retrieved_at,
      exposed.elevation_retrieved_at
    )
  );
}
