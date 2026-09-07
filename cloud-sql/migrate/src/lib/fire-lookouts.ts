export interface LookoutSource {
  source: "ffla" | "osm" | "official";
  sourceId: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
  url: string;
  structureType?: string;
  state?: string;
  reviewedMatches?: Array<{destinationId: string; evidenceUrl: string; note: string}>;
}

export interface LookoutDestination {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  features: string[];
}

export function auditedLookoutFeatures(features: string[], action: "keep_fire_lookout" | "remove_fire_lookout" | "replace_fire_lookout_with_viewpoint"): string[] {
  if (action === "keep_fire_lookout") return features.includes("fire-lookout") ? [...features] : [...features, "fire-lookout"];
  const next = features.filter(feature => feature !== "fire-lookout");
  if (action === "replace_fire_lookout_with_viewpoint" && !next.includes("viewpoint")) next.push("viewpoint");
  return next;
}

export function validCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;
}

export function lookoutName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(mt|mount|mountain|peak|fire|lookout|tower|observation)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radians = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * radians / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) *
    Math.sin((b.lng - a.lng) * radians / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LookoutMatch {
  destinationId: string;
  destinationName: string | null;
  source: LookoutSource;
  distanceMeters: number;
  method: "coordinates" | "name-and-coordinates" | "reviewed-place-link";
}

/** Standing is a structure claim, not a claim of staffing or public access. */
export function matchLookout(destination: LookoutDestination, source: LookoutSource): LookoutMatch | null {
  if (source.status !== "Standing" || !validCoordinates(source.lat, source.lng) ||
      !validCoordinates(destination.lat, destination.lng)) return null;
  if (!destination.features.some(f => f === "summit" || f === "volcano" || f === "fire-lookout")) return null;
  const distance = distanceMeters(destination as { lat: number; lng: number }, source);
  const reviewed = source.reviewedMatches?.some(match => match.destinationId === destination.id &&
    /^https:\/\//.test(match.evidenceUrl) && match.note.length > 0);
  if (reviewed && distance <= 2000) {
    return {destinationId: destination.id, destinationName: destination.name, source,
      distanceMeters: Math.round(distance * 10) / 10, method: "reviewed-place-link"};
  }
  const named = lookoutName(destination.name || "");
  const nameMatches = named.length > 0 && named === lookoutName(source.name);
  if (distance > (nameMatches ? 500 : 100)) return null;
  return {
    destinationId: destination.id, destinationName: destination.name, source,
    distanceMeters: Math.round(distance * 10) / 10,
    method: nameMatches ? "name-and-coordinates" : "coordinates",
  };
}

export interface OsmLookoutElement {
  type: string; id: number; lat?: number; lon?: number;
  center?: {lat: number; lon: number}; tags?: Record<string, string>;
}

/** Generic viewpoints and military watchtowers are not fire lookouts. */
export function osmLookout(element: OsmLookoutElement): LookoutSource | null {
  const t = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  const fire = (t["tower:type"] === "watchtower" && t.watchtower === "fire") ||
    t["tower:type"] === "fire" || t.emergency === "fire_lookout" ||
    t.building === "fire_lookout" || t.observation === "firewatch" || t.man_made === "fire_tower" ||
    (t.man_made === "tower" && /\bfire (lookout|tower)\b/i.test(t.name || ""));
  const gone = Object.entries(t).some(([key, value]) =>
    /^(demolished|destroyed|razed|removed|ruins)(:|$)/.test(key) && value !== "no") ||
    /\b(site|former|ruins|demolished|destroyed|removed)\b/i.test(t.name || "");
  if (!fire || gone || !validCoordinates(lat, lng)) return null;
  return {source: "osm", sourceId: `${element.type}/${element.id}`,
    name: t.name || "Fire lookout", lat: lat!, lng: lng!, status: "Standing",
    url: `https://www.openstreetmap.org/${element.type}/${element.id}`};
}
