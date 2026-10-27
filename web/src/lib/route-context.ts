export interface RoutePlace {
  id: string;
  name: string;
  elevation: number | null;
  features: string[];
  lat: number;
  lng: number;
  route_offset_m: number;
  distance_along_m: number;
  is_linked: boolean;
}

export interface RoutePlacePage {
  items: RoutePlace[];
  nextCursor: string | null;
  distanceThroughMeters: number;
}

export function parseRoutePlacePage(raw: unknown): RoutePlacePage {
  const page = raw as RoutePlacePage;
  if (!page || !Array.isArray(page.items)
    || !(page.nextCursor === null || typeof page.nextCursor === "string")
    || !Number.isFinite(page.distanceThroughMeters)) throw new Error("Invalid route places");
  for (const p of page.items) {
    if (!p || typeof p.id !== "string" || typeof p.name !== "string" || !Array.isArray(p.features)
      || ![p.lat,p.lng,p.route_offset_m,p.distance_along_m].every(Number.isFinite)
      || p.route_offset_m < 0 || p.distance_along_m < 0) throw new Error("Incomplete route place");
  }
  return page;
}

/** Repeated passes may occur in later windows. Keep the first encounter. */
export function mergeRoutePlaces(current: RoutePlace[], next: RoutePlace[]): RoutePlace[] {
  const seen = new Set<string>();
  return [...current,...next].filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).sort((a,b) => a.distance_along_m-b.distance_along_m || a.id.localeCompare(b.id));
}
