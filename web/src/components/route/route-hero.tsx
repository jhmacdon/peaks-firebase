import { StatCluster } from "../ui/stat";
import RouteMap from "./route-map-embed";

/** The route's live map, full-width — the flagship destination page's
 * no-photo hero branch (components/destination/destination-hero.tsx),
 * adapted for routes: there's no catalog photo to lead with, but every
 * route has geometry, so the map itself is the hero and carries distance +
 * gain on its scrim rather than repeating them as a second "Map" section
 * further down the page. */
export function RouteHero({
  polyline6,
  distanceValue,
  gainValue,
  className = "",
}: {
  polyline6: string | null;
  distanceValue: string | null;
  gainValue: string | null;
  className?: string;
}) {
  if (!polyline6) return null;

  return (
    <div className={`rounded-media relative isolate overflow-hidden ${className}`.trim()}>
      <RouteMap polyline6={polyline6} className="h-[260px] sm:h-[320px] lg:h-[380px]" />
      {distanceValue || gainValue ? (
        // z-[700] clears every Leaflet pane the scrim has to cover (tiles
        // 200, overlay 400, marker 600) and stays under the control layer
        // at 1000 — same reasoning as the destination hero's scrim.
        <div className="from-page via-page/85 pointer-events-none absolute inset-x-0 bottom-0 z-[700] flex gap-8 bg-gradient-to-t to-transparent px-5 pt-16 pb-4">
          {distanceValue ? (
            <StatCluster scale="page" value={distanceValue} unit="mi" label="Distance" />
          ) : null}
          {gainValue ? (
            <StatCluster scale="page" value={gainValue} unit="ft" label="Gain" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
