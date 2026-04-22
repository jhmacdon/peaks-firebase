import type { RouteDetail, RouteSegment } from "./actions/routes";

const METERS_TO_MILES = 1 / 1609.34;
const METERS_TO_FEET = 3.28084;

export function formatDistanceMeters(
  meters: number | null | undefined
): string {
  if (meters == null || Number.isNaN(meters)) return "—";
  if (meters < 1609.34) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters * METERS_TO_MILES).toFixed(1)} mi`;
}

export function formatElevationMeters(
  meters: number | null | undefined
): string {
  if (meters == null || Number.isNaN(meters)) return "—";
  return `${Math.round(meters * METERS_TO_FEET).toLocaleString()} ft`;
}

export function formatDurationHours(
  hours: number | null | undefined
): string {
  if (hours == null || Number.isNaN(hours)) return "—";

  const roundedMinutes = Math.max(0, Math.round(hours * 60));
  const wholeHours = Math.floor(roundedMinutes / 60);
  const mins = roundedMinutes % 60;

  if (wholeHours === 0) return `${mins}m`;
  if (mins === 0) return `${wholeHours}h`;
  return `${wholeHours}h ${mins}m`;
}

export function formatDurationRange(
  lowHours: number | null | undefined,
  highHours: number | null | undefined
): string {
  if (lowHours == null || highHours == null) return "—";
  return `${formatDurationHours(lowHours)} - ${formatDurationHours(highHours)}`;
}

export function describeRouteShape(shape: string | null | undefined): string {
  if (!shape) return "Unknown shape";
  return shape.replace(/_/g, " ");
}

export function describeCompletionMode(
  completion: string | null | undefined
): string {
  if (!completion || completion === "none") return "No preferred direction";
  if (completion === "straight") return "Recommended in the forward direction";
  if (completion === "reverse") return "Best experienced in reverse";
  return completion.replace(/_/g, " ");
}

export interface RouteGuideSummary {
  distanceMiles: number | null;
  gainFeet: number | null;
  lossFeet: number | null;
  climbingDensityFeetPerMile: number | null;
  estimatedHoursLow: number | null;
  estimatedHoursHigh: number | null;
  estimatedHoursMid: number | null;
  difficultyLabel: string;
  difficultyReason: string;
  routeShapeLabel: string;
  completionLabel: string;
  routeNarrative: string;
}

function difficultyFromScore(score: number): string {
  if (score < 4) return "Easy";
  if (score < 8) return "Moderate";
  if (score < 12) return "Hard";
  return "Strenuous";
}

export function summarizeRouteGuide(
  route: Pick<RouteDetail, "distance" | "gain" | "gain_loss" | "shape" | "completion" | "destination_count">,
  segmentCount = 0
): RouteGuideSummary {
  const distanceMiles =
    route.distance != null ? route.distance * METERS_TO_MILES : null;
  const gainFeet = route.gain != null ? route.gain * METERS_TO_FEET : null;
  const lossFeet =
    route.gain_loss != null ? route.gain_loss * METERS_TO_FEET : null;

  const climbingDensityFeetPerMile =
    distanceMiles && distanceMiles > 0 && gainFeet != null
      ? gainFeet / distanceMiles
      : null;

  const shape = route.shape || "unknown";
  const completion = route.completion || "none";

  const shapeScore =
    shape === "point_to_point" ? 0.6 : shape === "out_and_back" ? 0.4 : 0.2;
  const completionScore = completion === "reverse" ? 0.35 : 0;
  const distanceScore = distanceMiles != null ? distanceMiles * 0.65 : 0;
  const climbScore = gainFeet != null ? gainFeet / 1600 : 0;
  const densityScore =
    climbingDensityFeetPerMile != null
      ? climbingDensityFeetPerMile / 2500
      : 0;
  const difficultyScore =
    distanceScore + climbScore + densityScore + shapeScore + completionScore;

  const difficultyLabel = difficultyFromScore(difficultyScore);

  const difficultyReason =
    climbingDensityFeetPerMile != null && climbingDensityFeetPerMile > 1200
      ? "steep climbing density"
      : gainFeet != null && gainFeet > 3000
        ? "substantial elevation gain"
        : distanceMiles != null && distanceMiles > 8
          ? "long mileage"
          : "balanced mileage and climb";

  const hikingHoursBase =
    (distanceMiles ?? 0) / 2.1 +
    (gainFeet ?? 0) / 2200 +
    (shape === "point_to_point" ? 0.3 : shape === "out_and_back" ? 0.15 : 0);
  const estimatedHoursMid =
    distanceMiles != null || gainFeet != null
      ? Math.max(0.5, hikingHoursBase)
      : null;
  const estimatedHoursLow =
    estimatedHoursMid != null ? Math.max(0.5, estimatedHoursMid * 0.85) : null;
  const estimatedHoursHigh =
    estimatedHoursMid != null ? estimatedHoursMid * 1.2 : null;

  const routeShapeLabel = describeRouteShape(route.shape);
  const completionLabel = describeCompletionMode(route.completion);

  const routeNarrative = [
    route.destination_count > 0
      ? `${route.destination_count} linked destination${route.destination_count === 1 ? "" : "s"}`
      : "no linked destinations",
    distanceMiles != null ? `${distanceMiles.toFixed(1)} mi long` : null,
    gainFeet != null ? `${Math.round(gainFeet).toLocaleString()} ft of gain` : null,
    segmentCount > 0 ? `built from ${segmentCount} segment${segmentCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return {
    distanceMiles,
    gainFeet,
    lossFeet,
    climbingDensityFeetPerMile,
    estimatedHoursLow,
    estimatedHoursHigh,
    estimatedHoursMid,
    difficultyLabel,
    difficultyReason,
    routeShapeLabel,
    completionLabel,
    routeNarrative,
  };
}

export interface ParsedExternalRouteLink {
  type: string;
  id: string;
  href: string;
  label: string;
  display: string;
}

function titleize(input: string): string {
  return input
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function buildKnownExternalUrl(type: string, id: string): string {
  const lower = type.toLowerCase();

  if (isHttpUrl(id)) return id;

  if (lower.includes("alltrails")) {
    return `https://www.alltrails.com/search?q=${encodeURIComponent(id)}`;
  }
  if (lower.includes("strava")) {
    return `https://www.strava.com/routes/${encodeURIComponent(id)}`;
  }
  if (lower.includes("gaia")) {
    return `https://www.gaiagps.com/public/${encodeURIComponent(id)}`;
  }
  if (lower.includes("caltopo")) {
    return `https://caltopo.com/m/${encodeURIComponent(id)}`;
  }
  if (lower.includes("wikiloc")) {
    return `https://www.wikiloc.com/wikiloc/view.do?id=${encodeURIComponent(id)}`;
  }
  if (lower.includes("trailforks")) {
    return `https://www.trailforks.com/search/?q=${encodeURIComponent(id)}`;
  }
  if (lower.includes("openstreetmap") || lower === "osm") {
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(id)}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(`${type} ${id}`.trim())}`;
}

export function parseExternalRouteLinks(
  links: unknown[] | null | undefined
): ParsedExternalRouteLink[] {
  if (!Array.isArray(links)) return [];

  return links
    .map((link): ParsedExternalRouteLink | null => {
      if (!link || typeof link !== "object") return null;
      const raw = link as Record<string, unknown>;
      const type = String(raw.type ?? raw.source ?? raw.provider ?? "external");
      const id = String(raw.id ?? raw.url ?? raw.href ?? "").trim();
      if (!id) return null;

      const href = buildKnownExternalUrl(type, id);
      const label = titleize(type || "external");
      const display = isHttpUrl(id) ? new URL(id).host.replace(/^www\./, "") : id;

      return {
        type,
        id,
        href,
        label,
        display,
      };
    })
    .filter((link): link is ParsedExternalRouteLink => link !== null);
}

export interface SegmentSummary {
  count: number;
  sharedCount: number;
  reverseCount: number;
  totalDistanceMiles: number;
  mostSharedCount: number;
}

export function summarizeSegments(segments: RouteSegment[]): SegmentSummary {
  let sharedCount = 0;
  let reverseCount = 0;
  let totalDistanceMiles = 0;
  let mostSharedCount = 0;

  for (const segment of segments) {
    if (segment.route_count > 1) sharedCount += 1;
    if (segment.direction === "reverse") reverseCount += 1;
    if (segment.distance != null) {
      totalDistanceMiles += segment.distance * METERS_TO_MILES;
    }
    if (segment.route_count > mostSharedCount) {
      mostSharedCount = segment.route_count;
    }
  }

  return {
    count: segments.length,
    sharedCount,
    reverseCount,
    totalDistanceMiles,
    mostSharedCount,
  };
}
