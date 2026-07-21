export const PEAK_SPATIAL_MATCH_METERS = 150;
export const PEAK_NAME_MATCH_METERS = 1_000;
export const PEAK_COVERAGE_GRID_DEGREES = 0.5;

export interface ReferencePeak {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  elevationM: number | null;
  wikidataId: string | null;
  wikipedia: string | null;
}

export interface CatalogPeak {
  id: string;
  name: string;
  lat: number;
  lng: number;
  osmId: string | null;
}

export type PeakMatchMethod = "osm_id" | "spatial" | "name_spatial";

export interface PeakMatch {
  reference: ReferencePeak;
  method: PeakMatchMethod | null;
  destinationId: string | null;
  destinationName: string | null;
  distanceMeters: number | null;
}

export interface SessionProximityEvidence {
  sessionsWithin30m: number;
  sessionsWithin100m: number;
  sessionsWithin250m: number;
}

export type CoverageConfidence = "track_proven" | "strong_reference" | "review";

export interface RankedCoverageCandidate extends PeakMatch, SessionProximityEvidence {
  confidence: CoverageConfidence;
  priorityScore: number;
  reviewFlags: string[];
}

export interface GridCoverage {
  grid: string;
  minLat: number;
  minLng: number;
  referencePeaks: number;
  matchedPeaks: number;
  missingPeaks: number;
  coveragePercent: number;
}

export function normalizePeakName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parse OSM's `ele` convention (meters unless an explicit imperial suffix is
 * present). Some US nodes contain a bare feet value; callers may opt into a
 * state-appropriate threshold for that known data-quality issue. Never use the
 * heuristic for Alaska, where legitimate elevations exceed 5,000 meters.
 */
export function parseElevationMeters(
  raw: string | null | undefined,
  assumeFeetAboveMeters: number | null = null
): number | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(/,/g, "");
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;

  const explicitlyFeet = /\b(ft|feet|foot)\b/i.test(normalized);
  if (explicitlyFeet || (assumeFeetAboveMeters != null && value > assumeFeetAboveMeters)) {
    return value / 3.28084;
  }
  return value;
}

export function haversineMeters(
  lhs: Pick<ReferencePeak, "lat" | "lng">,
  rhs: Pick<CatalogPeak, "lat" | "lng">
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const lhsLat = radians(lhs.lat);
  const rhsLat = radians(rhs.lat);
  const deltaLat = rhsLat - lhsLat;
  const deltaLng = radians(rhs.lng - lhs.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lhsLat) * Math.cos(rhsLat) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function matchReferencePeak(
  reference: ReferencePeak,
  catalog: CatalogPeak[],
  spatialMatchMeters = PEAK_SPATIAL_MATCH_METERS,
  nameMatchMeters = PEAK_NAME_MATCH_METERS
): PeakMatch {
  const byOsmId = catalog.find((candidate) => candidate.osmId === reference.osmId);
  if (byOsmId) {
    return matched(reference, byOsmId, "osm_id");
  }

  let nearest: CatalogPeak | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestSameName: CatalogPeak | null = null;
  let nearestSameNameDistance = Number.POSITIVE_INFINITY;
  const referenceName = normalizePeakName(reference.name);

  for (const candidate of catalog) {
    const distance = haversineMeters(reference, candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
    if (
      normalizePeakName(candidate.name) === referenceName &&
      distance < nearestSameNameDistance
    ) {
      nearestSameName = candidate;
      nearestSameNameDistance = distance;
    }
  }

  if (nearest && nearestDistance <= spatialMatchMeters) {
    return matched(reference, nearest, "spatial", nearestDistance);
  }
  if (nearestSameName && nearestSameNameDistance <= nameMatchMeters) {
    return matched(reference, nearestSameName, "name_spatial", nearestSameNameDistance);
  }

  return {
    reference,
    method: null,
    destinationId: nearest?.id ?? null,
    destinationName: nearest?.name ?? null,
    distanceMeters: Number.isFinite(nearestDistance) ? nearestDistance : null,
  };
}

function matched(
  reference: ReferencePeak,
  destination: CatalogPeak,
  method: PeakMatchMethod,
  distanceMeters = haversineMeters(reference, destination)
): PeakMatch {
  return {
    reference,
    method,
    destinationId: destination.id,
    destinationName: destination.name,
    distanceMeters,
  };
}

export function reviewFlagsForCandidate(match: PeakMatch): string[] {
  const flags: string[] = [];
  const name = match.reference.name.trim();
  if (/^(point|pt\.?|peak)\s*[a-z0-9.-]+$/i.test(name)) flags.push("generic_name");
  if (/\b(north|south|east|west|middle|central)\b|\b(spire|cleaver|knob|bump)\b/i.test(name)) {
    flags.push("possible_subpeak");
  }
  if (match.reference.elevationM == null) flags.push("missing_elevation");
  if (match.distanceMeters != null && match.distanceMeters < 500) flags.push("near_existing_destination");
  return flags;
}

export function rankCoverageCandidate(
  match: PeakMatch,
  evidence: SessionProximityEvidence
): RankedCoverageCandidate {
  if (match.method != null) {
    throw new Error("Only unmatched peaks can be ranked as coverage candidates");
  }

  const flags = reviewFlagsForCandidate(match);
  const outer100 = Math.max(0, evidence.sessionsWithin100m - evidence.sessionsWithin30m);
  const outer250 = Math.max(0, evidence.sessionsWithin250m - evidence.sessionsWithin100m);
  let score =
    evidence.sessionsWithin30m * 100_000 +
    outer100 * 5_000 +
    outer250 * 500;

  if (match.reference.wikidataId) score += 250;
  if (match.reference.wikipedia) score += 150;
  if (match.reference.elevationM != null) {
    score += Math.min(400, Math.max(0, match.reference.elevationM / 10));
  }
  if (flags.includes("generic_name")) score -= 500;
  if (flags.includes("possible_subpeak")) score -= 100;
  if (flags.includes("near_existing_destination")) score -= 100;

  const confidence: CoverageConfidence = evidence.sessionsWithin30m > 0
    ? "track_proven"
    : (match.reference.wikidataId != null || match.reference.wikipedia != null) &&
        match.reference.elevationM != null &&
        (match.distanceMeters == null || match.distanceMeters >= 500)
      ? "strong_reference"
      : "review";

  return {
    ...match,
    ...evidence,
    confidence,
    priorityScore: Math.round(score),
    reviewFlags: flags,
  };
}

export function compareRankedCandidates(
  lhs: RankedCoverageCandidate,
  rhs: RankedCoverageCandidate
): number {
  return rhs.priorityScore - lhs.priorityScore ||
    lhs.reference.name.localeCompare(rhs.reference.name);
}

export function buildGridCoverage(matches: PeakMatch[]): GridCoverage[] {
  const cells = new Map<string, GridCoverage>();
  for (const match of matches) {
    const minLat = Math.floor(match.reference.lat / PEAK_COVERAGE_GRID_DEGREES) * PEAK_COVERAGE_GRID_DEGREES;
    const minLng = Math.floor(match.reference.lng / PEAK_COVERAGE_GRID_DEGREES) * PEAK_COVERAGE_GRID_DEGREES;
    const key = `${minLat.toFixed(1)},${minLng.toFixed(1)}`;
    const cell = cells.get(key) ?? {
      grid: key,
      minLat,
      minLng,
      referencePeaks: 0,
      matchedPeaks: 0,
      missingPeaks: 0,
      coveragePercent: 0,
    };
    cell.referencePeaks++;
    if (match.method == null) cell.missingPeaks++;
    else cell.matchedPeaks++;
    cell.coveragePercent = Math.round((cell.matchedPeaks / cell.referencePeaks) * 1_000) / 10;
    cells.set(key, cell);
  }

  return [...cells.values()].sort(
    (lhs, rhs) => rhs.missingPeaks - lhs.missingPeaks || lhs.coveragePercent - rhs.coveragePercent
  );
}
