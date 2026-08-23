import RouteMap from "./route-map-embed";

/** The route's live map, full-width. Route facts sit in the single topline
 * below it, rather than appearing once on the map and again below. */
export function RouteHero({
  polyline6,
  className = "",
}: {
  polyline6: string | null;
  className?: string;
}) {
  if (!polyline6) return null;

  return (
    <div className={`rounded-media relative isolate overflow-hidden ${className}`.trim()}>
      <RouteMap polyline6={polyline6} className="h-[260px] sm:h-[320px] lg:h-[380px]" />
    </div>
  );
}
