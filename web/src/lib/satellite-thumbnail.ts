const ARCGIS_WORLD_IMAGERY_EXPORT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";

// Four kilometres across gives a row thumbnail enough terrain context to
// read as a place without pulling so far back that the summit disappears.
const HALF_SPAN_METERS = 2_000;
const METERS_PER_DEGREE = 111_320;
const MAX_WEB_MERCATOR_LATITUDE = 85.051129;

function fixedCoordinate(value: number): string {
  return value.toFixed(6);
}

/** A small, centred satellite image for a destination row. The export is
 * 96px for a sharp 48px circle on retina screens. Invalid or unmappable
 * coordinates return null so the caller can keep a local placeholder. */
export function satelliteThumbnailUrl(
  lat: number | null,
  lng: number | null
): string | null {
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > MAX_WEB_MERCATOR_LATITUDE ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  const latitudeDelta = HALF_SPAN_METERS / METERS_PER_DEGREE;
  const longitudeDelta =
    HALF_SPAN_METERS /
    (METERS_PER_DEGREE * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const bbox = [
    lng - longitudeDelta,
    lat - latitudeDelta,
    lng + longitudeDelta,
    lat + latitudeDelta,
  ]
    .map(fixedCoordinate)
    .join(",");
  const params = new URLSearchParams({
    bbox,
    bboxSR: "4326",
    size: "96,96",
    format: "jpg",
    f: "image",
  });

  return `${ARCGIS_WORLD_IMAGERY_EXPORT}?${params.toString()}`;
}
