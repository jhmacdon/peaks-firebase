/**
 * GPX file parser. Extracts track points with lat, lng, and optional elevation.
 */

export interface GPXPoint {
  lat: number;
  lng: number;
  ele: number | null;
  time: string | null;
}

export interface GPXWaypoint {
  lat: number;
  lng: number;
  ele: number | null;
  name: string | null;
  description: string | null;
  symbol: string | null;
}

export interface ParsedGPX {
  name: string | null;
  description: string | null;
  points: GPXPoint[];
  waypoints: GPXWaypoint[];
  creator: string | null;
}

/**
 * Parse a GPX XML string into structured track points.
 * Handles both <trk>/<trkseg>/<trkpt> and <rte>/<rtept> formats.
 */
export function parseGPX(gpxContent: string): ParsedGPX {
  // Simple XML parsing using regex — GPX is well-structured enough for this
  const name = extractTag(gpxContent, "name");
  const description = extractTag(gpxContent, "desc");
  const creator = extractAttribute(gpxContent, "gpx", "creator");

  const points: GPXPoint[] = [];

  // Try track points first (<trkpt>), fall back to route points (<rtept>)
  // Match both self-closing (<trkpt ... />) and paired (<trkpt>...</trkpt>) elements
  const pairedTrkpts = gpxContent.match(/<trkpt[^>]*>[\s\S]*?<\/trkpt>/g) || [];
  const selfClosingTrkpts = gpxContent.match(/<trkpt[^>]*\/>/g) || [];
  const pairedRtepts = gpxContent.match(/<rtept[^>]*>[\s\S]*?<\/rtept>/g) || [];
  const selfClosingRtepts = gpxContent.match(/<rtept[^>]*\/>/g) || [];

  const allBlocks = pairedTrkpts.length > 0 || selfClosingTrkpts.length > 0
    ? [...pairedTrkpts, ...selfClosingTrkpts]
    : [...pairedRtepts, ...selfClosingRtepts];

  for (const block of allBlocks) {
    const latMatch = block.match(/lat="([^"]+)"/);
    const lngMatch = block.match(/lon="([^"]+)"/) || block.match(/lng="([^"]+)"/);

    if (!latMatch || !lngMatch) continue;

    const lat = parseFloat(latMatch[1]);
    const lng = parseFloat(lngMatch[1]);

    if (isNaN(lat) || isNaN(lng)) continue;

    // ele can be a child element OR an attribute
    const eleTagStr = extractTag(block, "ele");
    const eleAttrMatch = block.match(/\bele="([^"]+)"/);
    const eleStr = eleTagStr || (eleAttrMatch ? eleAttrMatch[1] : null);
    const ele = eleStr ? parseFloat(eleStr) : null;
    const time = extractTag(block, "time");

    points.push({ lat, lng, ele: ele !== null && !isNaN(ele) ? ele : null, time });
  }

  // Parse waypoints (<wpt>)
  const waypoints: GPXWaypoint[] = [];
  const pairedWpts = gpxContent.match(/<wpt[^>]*>[\s\S]*?<\/wpt>/g) || [];
  const selfClosingWpts = gpxContent.match(/<wpt[^>]*\/>/g) || [];
  const allWpts = [...pairedWpts, ...selfClosingWpts];

  for (const block of allWpts) {
    const latMatch = block.match(/lat="([^"]+)"/);
    const lngMatch = block.match(/lon="([^"]+)"/) || block.match(/lng="([^"]+)"/);
    if (!latMatch || !lngMatch) continue;

    const lat = parseFloat(latMatch[1]);
    const lng = parseFloat(lngMatch[1]);
    if (isNaN(lat) || isNaN(lng)) continue;

    const eleTagStr = extractTag(block, "ele");
    const eleAttrMatch = block.match(/\bele="([^"]+)"/);
    const eleStr = eleTagStr || (eleAttrMatch ? eleAttrMatch[1] : null);
    const ele = eleStr ? parseFloat(eleStr) : null;

    waypoints.push({
      lat,
      lng,
      ele: ele !== null && !isNaN(ele) ? ele : null,
      name: extractTag(block, "name"),
      description: extractTag(block, "desc"),
      symbol: extractTag(block, "sym"),
    });
  }

  return { name, description, points, waypoints, creator };
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return match ? match[1].trim() : null;
}

function extractAttribute(xml: string, tag: string, attr: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`));
  return match ? match[1] : null;
}

/**
 * Compute distance between two lat/lng points in meters (Haversine).
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Compute total distance of a point array in meters.
 */
export function totalDistance(points: { lat: number; lng: number }[]): number {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    dist += haversineDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return dist;
}

/**
 * Detect if a track is out-and-back by checking if second half retraces first half.
 * Returns confidence 0-1 and the detected turnaround index.
 */
export function detectOutAndBack(
  points: { lat: number; lng: number }[]
): { isOutAndBack: boolean; confidence: number; turnaroundIndex: number } {
  if (points.length < 10) {
    return { isOutAndBack: false, confidence: 0, turnaroundIndex: 0 };
  }

  // Find the point furthest from the start
  let maxDist = 0;
  let turnaroundIndex = 0;
  for (let i = 0; i < points.length; i++) {
    const d = haversineDistance(points[0].lat, points[0].lng, points[i].lat, points[i].lng);
    if (d > maxDist) {
      maxDist = d;
      turnaroundIndex = i;
    }
  }

  // Check if end is close to start (suggesting return)
  const startEndDist = haversineDistance(
    points[0].lat, points[0].lng,
    points[points.length - 1].lat, points[points.length - 1].lng
  );

  const totalDist = totalDistance(points);
  const startEndRatio = startEndDist / totalDist;

  // Check how well the second half mirrors the first half
  const firstHalf = points.slice(0, turnaroundIndex + 1);
  const secondHalf = points.slice(turnaroundIndex).reverse();

  const sampleCount = Math.min(20, Math.min(firstHalf.length, secondHalf.length));
  let matchDistance = 0;

  for (let i = 0; i < sampleCount; i++) {
    const fi = Math.floor((i / sampleCount) * firstHalf.length);
    const si = Math.floor((i / sampleCount) * secondHalf.length);
    matchDistance += haversineDistance(
      firstHalf[fi].lat, firstHalf[fi].lng,
      secondHalf[si].lat, secondHalf[si].lng
    );
  }

  const avgMatchDist = matchDistance / sampleCount;

  // Out-and-back if: end close to start AND second half roughly mirrors first
  // Threshold: avg deviation < 100m and start/end within 5% of total distance
  const isOutAndBack = startEndRatio < 0.05 && avgMatchDist < 100;
  const confidence = Math.max(0, Math.min(1,
    (1 - startEndRatio / 0.1) * 0.5 + (1 - avgMatchDist / 200) * 0.5
  ));

  return { isOutAndBack, confidence, turnaroundIndex };
}

/**
 * Detect route shape from point array.
 */
export function detectRouteShape(
  points: { lat: number; lng: number }[]
): { shape: "out_and_back" | "loop" | "point_to_point"; turnaroundIndex?: number } {
  if (points.length < 4) {
    return { shape: "point_to_point" };
  }

  const startEndDist = haversineDistance(
    points[0].lat, points[0].lng,
    points[points.length - 1].lat, points[points.length - 1].lng
  );
  const totalDist = totalDistance(points);
  const closedRatio = startEndDist / totalDist;

  // Start and end are close
  if (closedRatio < 0.05) {
    const oab = detectOutAndBack(points);
    if (oab.isOutAndBack && oab.confidence > 0.5) {
      return { shape: "out_and_back", turnaroundIndex: oab.turnaroundIndex };
    }
    return { shape: "loop" };
  }

  return { shape: "point_to_point" };
}

/**
 * Simplify a track by removing points that don't contribute significantly.
 * Uses Ramer-Douglas-Peucker algorithm adapted for lat/lng.
 */
export function simplifyTrack(
  points: { lat: number; lng: number; ele: number | null }[],
  toleranceMeters: number = 10
): { lat: number; lng: number; ele: number | null }[] {
  if (points.length <= 2) return points;

  // Find point with max distance from line between first and last
  let maxDist = 0;
  let maxIdx = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > toleranceMeters) {
    const left = simplifyTrack(points.slice(0, maxIdx + 1), toleranceMeters);
    const right = simplifyTrack(points.slice(maxIdx), toleranceMeters);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function perpendicularDistance(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number }
): number {
  const dTotal = haversineDistance(lineStart.lat, lineStart.lng, lineEnd.lat, lineEnd.lng);
  if (dTotal === 0) return haversineDistance(point.lat, point.lng, lineStart.lat, lineStart.lng);

  const dStartToPoint = haversineDistance(lineStart.lat, lineStart.lng, point.lat, point.lng);
  const dEndToPoint = haversineDistance(lineEnd.lat, lineEnd.lng, point.lat, point.lng);

  // Use Heron's formula for triangle area, then height = 2*area/base
  const s = (dTotal + dStartToPoint + dEndToPoint) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - dTotal) * (s - dStartToPoint) * (s - dEndToPoint)));
  return (2 * area) / dTotal;
}
