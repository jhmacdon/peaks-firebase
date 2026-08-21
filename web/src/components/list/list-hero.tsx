"use client";

import type { ListDestination } from "../../lib/actions/lists";
import { useListCompletion } from "./list-completion-context";
import ListMap from "./list-map-embed";

/** The list's own map, full-bleed — the same "map treated as a photo" move
 * as the area page's boundary hero (area-hero.tsx), adapted for a list: the
 * markers are every mapped destination on the list rather than a single
 * boundary, colored by the signed-in reader's own completion. Renders null
 * under two coordinates — a map with 0 or 1 dots doesn't earn the page's
 * biggest slab. */
export function ListHero({
  destinations,
  className = "",
}: {
  destinations: ListDestination[];
  className?: string;
}) {
  // Sparse semantics (list-completion-context.tsx): a missing key means
  // "not reached", never "zero visits" — and entries is null while
  // loading/signed-out, so every marker reads `completed: false` until a
  // signed-in reader's completion has actually loaded.
  const { entries } = useListCompletion();

  const markers = destinations
    .filter(
      (destination): destination is ListDestination & { lat: number; lng: number } =>
        destination.lat != null && destination.lng != null
    )
    .map((destination) => ({
      id: destination.id,
      name: destination.name,
      lat: destination.lat,
      lng: destination.lng,
      completed: entries?.[destination.id] != null,
    }));

  if (markers.length < 2) return null;

  return (
    <div
      className={`h-[260px] sm:h-[320px] lg:h-[380px] rounded-media relative isolate overflow-hidden ${className}`.trim()}
    >
      <ListMap markers={markers} className="h-full w-full" />
      {/* z-[750] clears every Leaflet pane the scrim has to cover (tiles
          200, overlay 400, marker 600, popup 700) and stays under the
          control layer at 1000, so the layer switcher and tile attribution
          stay clickable. */}
      <div className="from-page via-page/85 pointer-events-none absolute inset-x-0 bottom-0 z-[750] bg-gradient-to-t to-transparent px-5 pt-16 pb-4" />
    </div>
  );
}
