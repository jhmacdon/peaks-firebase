import type { RouteDetail, RouteSegment } from "./actions/routes";
import { formatDurationRangeFriendly, formatSessionCount } from "./format";

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

/** Human-readable route shape, or null when the shape isn't known — callers
 * omit the shape word/clause entirely rather than print "Unknown shape". */
export function describeRouteShape(shape: string | null | undefined): string | null {
  if (!shape) return null;
  return shape.replace(/_/g, " ");
}

/** Whether to show the "Elevation loss" stat. Non-loop routes (out-and-back
 * uses the round-trip vertical, point-to-point/lollipop store loss
 * separately) often have no real loss data, and "0 ft" reads as a measured
 * fact rather than a missing value — hide the stat instead. Loop routes
 * always show it: loss is core to what a loop is, so even a genuine 0 is
 * worth stating. */
export function shouldShowElevationLoss(
  lossMeters: number | null | undefined,
  shape: string | null | undefined
): boolean {
  if (shape === "loop") return true;
  return lossMeters != null && lossMeters !== 0;
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
  difficultyLabel: string | null;
  difficultyReason: string;
  routeShapeLabel: string | null;
  completionLabel: string;
  routeNarrative: string;
}

export interface RouteTraversalMetrics {
  distanceMeters: number | null;
  gainMeters: number | null;
  lossMeters: number | null;
}

export function getRouteTraversalMetrics(
  route: Pick<RouteDetail, "distance" | "gain" | "gain_loss" | "shape">
): RouteTraversalMetrics {
  if (route.shape !== "out_and_back") {
    return {
      distanceMeters: route.distance,
      gainMeters: route.gain,
      lossMeters: route.gain_loss,
    };
  }

  const roundTripVertical =
    route.gain != null || route.gain_loss != null
      ? (route.gain ?? 0) + (route.gain_loss ?? 0)
      : null;

  return {
    distanceMeters: route.distance != null ? route.distance * 2 : null,
    gainMeters: roundTripVertical,
    lossMeters: roundTripVertical,
  };
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
  const traversal = getRouteTraversalMetrics(route);
  const distanceMiles =
    traversal.distanceMeters != null
      ? traversal.distanceMeters * METERS_TO_MILES
      : null;
  const gainFeet =
    traversal.gainMeters != null
      ? traversal.gainMeters * METERS_TO_FEET
      : null;
  const lossFeet =
    traversal.lossMeters != null
      ? traversal.lossMeters * METERS_TO_FEET
      : null;

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

  const rawDifficultyLabel = difficultyFromScore(difficultyScore);
  // Plausibility gate: the score under-weights routes that gain a lot of
  // elevation gradually (low density, long distance), so it can call a
  // >3000 ft climb "Moderate" — a grade no one would trust. Hide the label
  // rather than show a difficulty a reader would rightly distrust.
  const difficultyLabel: string | null =
    rawDifficultyLabel === "Moderate" && gainFeet != null && gainFeet > 3000
      ? null
      : rawDifficultyLabel;

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

/** The route's About paragraphs — what it is, how hard/long it runs, who's
 * followed it, and (folded in rather than given its own sidebar box) which
 * direction it's best done. One template for every route page, same as
 * buildDestinationGuide serves every destination page. */
export function buildRouteAbout(
  name: string,
  route: Pick<RouteDetail, "shape" | "completion">,
  guide: RouteGuideSummary,
  sessionCount: number
): string[] {
  const paragraphs: string[] = [];

  const shapeLabel = describeRouteShape(route.shape);
  const routeNoun = shapeLabel
    ? `${/^[aeiou]/i.test(shapeLabel) ? "an" : "a"} ${shapeLabel} route`
    : "a route";
  paragraphs.push(
    [
      `${name} is ${routeNoun}`,
      guide.distanceMiles != null ? ` covering ${guide.distanceMiles.toFixed(1)} miles` : "",
      guide.gainFeet != null
        ? ` with ${Math.round(guide.gainFeet).toLocaleString()} feet of elevation gain`
        : "",
      ".",
    ].join("")
  );

  const difficultyText = guide.difficultyLabel
    ? `It rates as ${guide.difficultyLabel.toLowerCase()} given its ${guide.difficultyReason}.`
    : null;
  const timeText =
    guide.estimatedHoursLow != null
      ? `Plan on ${formatDurationRangeFriendly(guide.estimatedHoursLow, guide.estimatedHoursHigh)} of moving time.`
      : null;
  const planSentence = [difficultyText, timeText].filter(Boolean).join(" ");
  if (planSentence) paragraphs.push(planSentence);

  if (route.completion && route.completion !== "none") {
    paragraphs.push(`${describeCompletionMode(route.completion)}.`);
  }

  if (sessionCount > 0) {
    paragraphs.push(
      `${formatSessionCount(sessionCount)} ${sessionCount === 1 ? "has" : "have"} followed this route.`
    );
  }

  return paragraphs;
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
