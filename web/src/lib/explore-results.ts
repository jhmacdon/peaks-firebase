// What the explorer's panel lists: the destinations and routes currently
// loaded, folded into one list sorted by how far each sits from the middle
// of the screen. Pure and Leaflet-free so the ordering, the deduping and
// the type words are unit-tested rather than eyeballed on a map.

import {
  dedupeByNameAndProximity,
  destinationTypeWord,
  haversineMeters,
} from "./map-view";
import { polylineMidpoint } from "./polyline";
import { catalogHitHref, type CatalogHit } from "./catalog-results";
import { getRouteTraversalMetrics } from "./route-guide";
import { formatRegion } from "./regions";

export interface ExploreDestinationInput {
  id: string;
  name: string | null;
  elevation: number | null;
  lat: number | null;
  lng: number | null;
  features: string[];
  hero_image?: string | null;
  hero_image_attribution?: string | null;
  hero_image_attribution_url?: string | null;
  state_code?: string | null;
  country_code?: string | null;
}

export interface ExploreRouteInput {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
  gain_loss?: number | null;
  shape?: string | null;
  cover_image?: string | null;
  cover_image_attribution?: string | null;
  cover_image_attribution_url?: string | null;
}

export interface ExploreResult {
  kind: "destination" | "route" | "area" | "list";
  id: string;
  name: string | null;
  /** The one word the row calls this: Peak, Lake, Route… */
  typeWord: string;
  lat: number;
  lng: number;
  metersFromCenter: number;
  /** Destinations only. */
  elevation: number | null;
  /** Routes only. */
  routeDistance: number | null;
  routeGain: number | null;
  imageUrl?: string | null;
  imageAttribution?: string | null;
  imageAttributionUrl?: string | null;
  locationLabel?: string | null;
  href?: string;
}

export function catalogHitToExploreResult(hit: CatalogHit, centerLat: number, centerLng: number): ExploreResult {
  const metrics = hit.route ? getRouteTraversalMetrics(hit.route) : null;
  const lat=hit.lat??centerLat;
  const lng=hit.lng??centerLng;
  return {
    kind:hit.kind==="destinations"?"destination":hit.kind==="routes"?"route":hit.kind==="areas"?"area":"list",
    id:hit.id,name:hit.name,typeWord:hit.destination?destinationTypeWord(hit.destination.features):hit.kind==="areas"?"Protected area":hit.kind==="lists"?"List":"Route",
    lat,lng,metersFromCenter:haversineMeters(centerLat,centerLng,lat,lng),elevation:hit.destination?.elevation??null,
    routeDistance:metrics?.distanceMeters??null,routeGain:metrics?.gainMeters??null,imageUrl:hit.imageUrl,locationLabel:hit.locationLabel,href:catalogHitHref(hit),
    imageAttribution:hit.destination?.hero_image_attribution??hit.route?.cover_image_attribution??hit.area?.cover_photo?.attribution,
    imageAttributionUrl:hit.destination?.hero_image_attribution_url??hit.route?.cover_image_attribution_url??hit.area?.cover_photo?.attributionUrl,
  };
}

/**
 * One list, nearest first.
 *
 * Destinations are deduped by name and proximity — the catalog carries the
 * same lake from two sources often enough that an undeduped panel reads as
 * a stutter — but only against each other: a peak and the route up it share
 * a name honestly, and dropping either would lose a real result.
 */
/** One destination as a panel row, or null when it has no location to
 * measure from. Exported so the search list can reuse the row shape while
 * keeping its own relevance order. */
export function describeDestination(
  destination: ExploreDestinationInput,
  centerLat: number,
  centerLng: number
): ExploreResult | null {
  if (destination.lat == null || destination.lng == null) return null;
  return {
    kind: "destination",
    id: destination.id,
    name: destination.name,
    typeWord: destinationTypeWord(destination.features),
    lat: destination.lat,
    lng: destination.lng,
    metersFromCenter: haversineMeters(
      centerLat,
      centerLng,
      destination.lat,
      destination.lng
    ),
    elevation: destination.elevation,
    routeDistance: null,
    routeGain: null,
    imageUrl: destination.hero_image,
    imageAttribution: destination.hero_image_attribution,
    imageAttributionUrl: destination.hero_image_attribution_url,
    locationLabel: formatRegion(destination.state_code, destination.country_code),
  };
}

export function buildExploreResults(input: {
  destinations: ExploreDestinationInput[];
  routes: ExploreRouteInput[];
  centerLat: number;
  centerLng: number;
}): ExploreResult[] {
  const { centerLat, centerLng } = input;

  const destinations: ExploreResult[] = input.destinations
    .map((destination) =>
      describeDestination(destination, centerLat, centerLng)
    )
    .filter((result): result is ExploreResult => result !== null)
    .sort((a, b) => a.metersFromCenter - b.metersFromCenter);

  const routes: ExploreResult[] = input.routes
    .map((route): ExploreResult | null => {
      const midpoint = polylineMidpoint(route.polyline6);
      if (!midpoint) return null;
      const metrics = getRouteTraversalMetrics({...route,shape:route.shape??null,gain_loss:route.gain_loss??null});
      return {
        kind: "route" as const,
        id: route.id,
        name: route.name,
        typeWord: "Route",
        lat: midpoint.lat,
        lng: midpoint.lng,
        metersFromCenter: haversineMeters(
          centerLat,
          centerLng,
          midpoint.lat,
          midpoint.lng
        ),
        elevation: null,
        routeDistance: metrics.distanceMeters,
        routeGain: metrics.gainMeters,
        imageUrl: route.cover_image,
        imageAttribution: route.cover_image_attribution,
        imageAttributionUrl: route.cover_image_attribution_url,
      };
    })
    .filter((route): route is ExploreResult => route !== null);

  return [...dedupeByNameAndProximity(destinations), ...routes].sort(
    (a, b) => a.metersFromCenter - b.metersFromCenter
  );
}
