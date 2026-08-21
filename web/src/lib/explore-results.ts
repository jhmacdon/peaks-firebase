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

export interface ExploreDestinationInput {
  id: string;
  name: string | null;
  elevation: number | null;
  lat: number | null;
  lng: number | null;
  features: string[];
}

export interface ExploreRouteInput {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
}

export interface ExploreResult {
  kind: "destination" | "route";
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
        routeDistance: route.distance,
        routeGain: route.gain,
      };
    })
    .filter((route): route is ExploreResult => route !== null);

  return [...dedupeByNameAndProximity(destinations), ...routes].sort(
    (a, b) => a.metersFromCenter - b.metersFromCenter
  );
}
