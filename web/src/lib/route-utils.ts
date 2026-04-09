/**
 * Shared route utilities (non-server-action).
 * Used by both route-builder.ts and segment-matcher.ts server actions.
 */

export interface TrackPoint {
  lat: number;
  lng: number;
  ele: number;
  dist: number; // cumulative distance from start in meters
}

/**
 * Encode an array of lat/lng points to a Google Polyline Algorithm string (precision 1e6).
 */
export function encodePolyline6(points: { lat: number; lng: number }[]): string {
  let encoded = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const p of points) {
    const lat = Math.round(p.lat * 1e6);
    const lng = Math.round(p.lng * 1e6);

    encoded += encodeValue(lat - prevLat);
    encoded += encodeValue(lng - prevLng);

    prevLat = lat;
    prevLng = lng;
  }

  return encoded;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";
  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  encoded += String.fromCharCode(v + 63);
  return encoded;
}

export function pointsToLineStringZ(points: TrackPoint[]): string {
  const coords = points.map((p) => `${p.lng} ${p.lat} ${p.ele}`).join(", ");
  return `LINESTRING Z(${coords})`;
}

export function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
