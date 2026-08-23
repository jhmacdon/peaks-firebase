// Shared map-explorer state: the URL contract, the type filters, and the
// small bits of geometry the panel needs. Deliberately Leaflet-free and
// side-effect-free so the map page can import it during SSR and so every
// rule here is unit-tested (map-view.test.ts) rather than only observable
// by driving a map.

/** Route polylines only render — and routes are only fetched — at or above
 * this zoom. Below it the viewport is continent-sized: the KNN query over
 * route geometry costs seconds, and hundreds of lines would draw as noise. */
export const ROUTE_MIN_ZOOM = 11;

export interface MapViewState {
  lat: number;
  lng: number;
  zoom: number;
}

/** Where the map opens when the URL pins nothing and the browser won't say
 * where the reader is (denied, unavailable, or timed out): the Washington
 * Cascades. A scenic, route-dense view beats the old zoom-5 continent,
 * which showed a grey nation-shaped blur and no results worth reading. */
export const DEFAULT_MAP_VIEW: MapViewState = { lat: 47.5, lng: -121.5, zoom: 9 };

/** Zoom the map settles on once geolocation answers. */
export const GEOLOCATED_ZOOM = 10;

/** Shortest text the explorer will search on. */
export const MIN_SEARCH_LENGTH = 2;

export type MapTypeId = "peaks" | "routes" | "lakes" | "waterfalls";

/**
 * The filter chips over the map, in display order.
 *
 * `features` maps a chip onto the `destination_feature` enum; the routes
 * chip has none because routes are a different table. Lakes and waterfalls
 * are off by default: the catalog holds 24,524 lakes against 41,547
 * summits, and in a typical Cascades viewport lakes outnumber peaks — left
 * on, they drown the panel.
 */
export const MAP_TYPES: {
  id: MapTypeId;
  label: string;
  features: readonly string[];
}[] = [
  { id: "peaks", label: "Peaks", features: ["summit", "volcano"] },
  { id: "routes", label: "Routes", features: [] },
  { id: "lakes", label: "Lakes", features: ["lake"] },
  { id: "waterfalls", label: "Waterfalls", features: ["waterfall"] },
];

export const DEFAULT_MAP_TYPES: MapTypeId[] = ["peaks", "routes"];

const ALL_TYPE_IDS: MapTypeId[] = MAP_TYPES.map((type) => type.id);
const DESTINATION_TYPE_IDS: MapTypeId[] = MAP_TYPES.filter(
  (type) => type.features.length > 0
).map((type) => type.id);

/** Chip ids in canonical order, so `types=routes,peaks` and
 * `types=peaks,routes` produce the same URL and the same cache key. */
function orderTypes(types: MapTypeId[]): MapTypeId[] {
  return ALL_TYPE_IDS.filter((id) => types.includes(id));
}

export function parseMapTypes(value: string | null | undefined): MapTypeId[] {
  if (value == null) return [...DEFAULT_MAP_TYPES];
  const parsed = value
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is MapTypeId =>
      ALL_TYPE_IDS.includes(part as MapTypeId)
    );
  // An explicit `types=` with nothing recognisable in it means the reader
  // hand-edited the URL, not that they want a blank map.
  return parsed.length > 0 ? orderTypes(parsed) : [...DEFAULT_MAP_TYPES];
}

function sameTypes(a: MapTypeId[], b: MapTypeId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The `types` param, or null when the selection is the default — the
 * default never appears in the URL, so /map and /map?types=peaks,routes
 * address one view rather than two (same rule as Discover's `type`). */
export function serializeMapTypes(types: MapTypeId[]): string | null {
  const ordered = orderTypes(types);
  if (sameTypes(ordered, DEFAULT_MAP_TYPES)) return null;
  return ordered.join(",");
}

export function allTypesSelected(types: MapTypeId[]): boolean {
  return ALL_TYPE_IDS.every((id) => types.includes(id));
}

export function typeSelected(types: MapTypeId[], id: MapTypeId): boolean {
  return types.includes(id);
}

/** Toggling the last chip off would leave a map with nothing on it, so the
 * last one stays on. */
export function toggleMapType(types: MapTypeId[], id: MapTypeId): MapTypeId[] {
  if (types.includes(id)) {
    const next = types.filter((type) => type !== id);
    return next.length > 0 ? orderTypes(next) : orderTypes(types);
  }
  return orderTypes([...types, id]);
}

/** Which chips draw destinations (everything except routes). */
export function destinationTypesSelected(types: MapTypeId[]): MapTypeId[] {
  return DESTINATION_TYPE_IDS.filter((id) => types.includes(id));
}

export function routesSelected(types: MapTypeId[]): boolean {
  return types.includes("routes");
}

/**
 * The `destination_feature` values to filter on, or null for "no filter".
 *
 * Null when every destination chip is on: that reads as "everything", so
 * the trailheads, huts, viewpoints and campsites that carry none of the
 * three named features come along too, rather than the union of three
 * features quietly hiding a third of the catalog.
 */
export function destinationFeatureFilter(types: MapTypeId[]): string[] | null {
  const selected = destinationTypesSelected(types);
  if (selected.length === 0) return [];
  if (selected.length === DESTINATION_TYPE_IDS.length) return null;
  return MAP_TYPES.filter((type) => selected.includes(type.id)).flatMap(
    (type) => [...type.features]
  );
}

/** Row caps for one viewport read. A map is a choice surface, not a catalog
 * dump: enough nearby places to explore, without painting hundreds of
 * overlapping dots or an endless result rail. */
export const VIEWPORT_DESTINATION_LIMIT = 40;
export const VIEWPORT_ROUTE_LIMIT = 24;

export interface MapExploreUrlState {
  /** null when the URL pinned no view — the map geolocates, then falls back
   * to DEFAULT_MAP_VIEW. A pinned view always wins: a shared link opens
   * exactly where it was saved. */
  view: MapViewState | null;
  types: MapTypeId[];
  query: string;
}

function parseNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseMapExploreUrl(search: string): MapExploreUrlState {
  const params = new URLSearchParams(search);
  const lat = parseNumber(params.get("lat"));
  const lng = parseNumber(params.get("lng"));
  const zoom = parseNumber(params.get("z"));
  const view =
    lat != null &&
    lng != null &&
    zoom != null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
      ? { lat, lng, zoom: Math.min(Math.max(Math.round(zoom), 2), 18) }
      : null;

  return {
    view,
    types: parseMapTypes(params.get("types")),
    query: (params.get("q") ?? "").trim(),
  };
}

/** The shareable URL for a view — `/map?lat=…&lng=…&z=…` plus the two
 * params that carry meaning only when they differ from the default. */
export function mapExploreHref(state: {
  view: MapViewState;
  types: MapTypeId[];
  query?: string;
}): string {
  const params = new URLSearchParams();
  params.set("lat", state.view.lat.toFixed(5));
  params.set("lng", state.view.lng.toFixed(5));
  params.set("z", String(Math.round(state.view.zoom)));
  const types = serializeMapTypes(state.types);
  if (types) params.set("types", types);
  const query = state.query?.trim();
  if (query) params.set("q", query);
  return `/map?${params.toString()}`;
}

/**
 * Whether to ask the browser where the reader is when the map opens.
 *
 * Only when the URL asked for nothing. A pinned view says where to look;
 * so does a query, which the explorer answers by flying to its best match.
 * Either way the link's intent outranks ambient location, and starting a
 * permission prompt whose answer we would then have to ignore is worse
 * than not asking.
 */
export function shouldAutoLocate(state: {
  view: MapViewState | null;
  query: string;
}): boolean {
  return state.view === null && state.query.trim().length < MIN_SEARCH_LENGTH;
}

/** A link that hands a search over to the explorer, which runs it on load
 * and flies to the best match. No view pinned: where to look is the answer
 * to the search, not something the linking page knows. */
export function mapSearchHref(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "/map";
  return `/map?q=${encodeURIComponent(trimmed)}`;
}

export interface ViewportBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Widest longitude span a viewport may ask for. A geography envelope that
 * spans the full 360° is degenerate in PostGIS — it matches nothing, which
 * is why a zoomed-all-the-way-out map used to come back empty. Leaflet also
 * hands back longitudes outside ±180 once the world wraps. */
const MAX_LNG_SPAN = 340;

export function clampViewportBounds(bounds: ViewportBounds): ViewportBounds {
  const minLat = Math.max(-85, Math.min(85, Math.min(bounds.minLat, bounds.maxLat)));
  const maxLat = Math.max(-85, Math.min(85, Math.max(bounds.minLat, bounds.maxLat)));

  let minLng = Math.min(bounds.minLng, bounds.maxLng);
  let maxLng = Math.max(bounds.minLng, bounds.maxLng);
  if (maxLng - minLng > MAX_LNG_SPAN) {
    const center = (minLng + maxLng) / 2;
    minLng = center - MAX_LNG_SPAN / 2;
    maxLng = center + MAX_LNG_SPAN / 2;
  }

  return {
    minLat,
    maxLat,
    minLng: Math.max(-180, Math.min(180, minLng)),
    maxLng: Math.max(-180, Math.min(180, maxLng)),
  };
}

const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Two rows this close carrying the same name are the same feature entered
 * twice (GNIS and OSM both name the same lake, a summit sits in the catalog
 * once per source). Far enough apart and they're genuinely two Bear Lakes. */
export const DUPLICATE_RADIUS_M = 1500;

function normalizeName(name: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Drop same-name rows that sit on top of each other, keeping the first —
 * so callers sort before deduping and the survivor is the nearest one.
 * Unnamed rows are never merged: an empty name is missing data, not a match.
 */
export function dedupeByNameAndProximity<
  T extends { name: string | null; lat: number; lng: number },
>(items: T[], radiusMeters: number = DUPLICATE_RADIUS_M): T[] {
  const keptByName = new Map<string, T[]>();
  const result: T[] = [];

  for (const item of items) {
    const key = normalizeName(item.name);
    if (!key) {
      result.push(item);
      continue;
    }
    const seen = keptByName.get(key);
    if (
      seen?.some(
        (other) =>
          haversineMeters(other.lat, other.lng, item.lat, item.lng) <=
          radiusMeters
      )
    ) {
      continue;
    }
    if (seen) seen.push(item);
    else keptByName.set(key, [item]);
    result.push(item);
  }

  return result;
}

// Feature → the one word a result row calls this place, most specific
// first: a volcano is a summit too, and every fire lookout is a lookout.
const FEATURE_WORDS: [string, string][] = [
  ["volcano", "Volcano"],
  ["fire-lookout", "Lookout"],
  ["lookout", "Lookout"],
  ["summit", "Peak"],
  ["waterfall", "Waterfall"],
  ["lake", "Lake"],
  ["hut", "Hut"],
  ["trailhead", "Trailhead"],
  ["viewpoint", "Viewpoint"],
  ["campsite", "Campsite"],
  ["landform", "Landform"],
];

export function destinationTypeWord(features: string[]): string {
  for (const [feature, word] of FEATURE_WORDS) {
    if (features.includes(feature)) return word;
  }
  return "Place";
}
