// Shared map-explorer view helpers. Deliberately leaflet-free so the map page
// can import it during SSR without pulling Leaflet into the server bundle.

/** Route polylines only render at or above this zoom level. */
export const ROUTE_MIN_ZOOM = 11;

export interface MapViewState {
  lat: number;
  lng: number;
  zoom: number;
}

function parseNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Read ?lat=&lng=&z= from the current URL. Returns null on the server. */
export function parseMapViewFromUrl(): MapViewState | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const lat = parseNumber(params.get("lat"));
  const lng = parseNumber(params.get("lng"));
  const zoom = parseNumber(params.get("z"));
  if (lat == null || lng == null || zoom == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, zoom: Math.min(Math.max(Math.round(zoom), 2), 18) };
}

export function mapViewToQuery(view: MapViewState): string {
  return `lat=${view.lat.toFixed(5)}&lng=${view.lng.toFixed(5)}&z=${view.zoom}`;
}
