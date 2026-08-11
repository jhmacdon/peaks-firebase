import type {
  SessionActivityType,
  SessionPoint,
} from "./actions/sessions";

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceBetweenSessionPoints(
  from: Pick<SessionPoint, "lat" | "lng">,
  to: Pick<SessionPoint, "lat" | "lng">
): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function buildSessionDistances(points: SessionPoint[]): number[] {
  if (points.length === 0) return [];

  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previousDistance = distances[index - 1];
    const segmentDistance =
      points[index - 1].segment_number === points[index].segment_number
        ? distanceBetweenSessionPoints(points[index - 1], points[index])
        : 0;
    distances.push(previousDistance + segmentDistance);
  }
  return distances;
}

export function findSessionPointIndex(
  points: SessionPoint[],
  targetTime: number
): number {
  if (points.length === 0) return -1;
  if (targetTime <= points[0].time) return 0;
  if (targetTime >= points[points.length - 1].time) return points.length - 1;

  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const time = points[middle].time;
    if (time === targetTime) return middle;
    if (time < targetTime) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const before = Math.max(0, high);
  const after = Math.min(points.length - 1, low);
  return targetTime - points[before].time <= points[after].time - targetTime
    ? before
    : after;
}

export function sessionActivityLabel(
  activityType: SessionActivityType | null
): string {
  switch (activityType) {
    case "ski":
      return "Ski";
    case "outdoor-moto":
      return "Moto";
    case "outdoor-trek":
      return "Hike";
    default:
      return "Outdoor activity";
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSessionGpx(
  name: string,
  points: SessionPoint[]
): string {
  const segments = new Map<number, SessionPoint[]>();
  for (const point of points) {
    const segment = segments.get(point.segment_number) ?? [];
    segment.push(point);
    segments.set(point.segment_number, segment);
  }

  const trackSegments = [...segments.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, segmentPoints]) => {
      const trackPoints = segmentPoints
        .map((point) => {
          const elevation =
            point.elevation != null && Number.isFinite(point.elevation)
              ? `\n          <ele>${String(point.elevation)}</ele>`
              : "";
          const time = Number.isFinite(point.time)
            ? `\n          <time>${new Date(point.time * 1000).toISOString()}</time>`
            : "";
          return `        <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}">${elevation}${time}
        </trkpt>`;
        })
        .join("\n");
      return `      <trkseg>
${trackPoints}
      </trkseg>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Peaks Web" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 https://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
${trackSegments}
  </trk>
</gpx>
`;
}
