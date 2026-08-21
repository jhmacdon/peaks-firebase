import type { AreaDetail } from "../../lib/actions/areas";
import AreaMap from "./area-map-embed";

/** The boundary, full-bleed — the flagship destination page's no-photo hero
 * branch (components/destination/destination-hero.tsx), adapted for areas:
 * there's no catalog photo, and unlike a summit an area has no one obvious
 * headline numeral (no stored acreage), so the scrim carries only the
 * designation word rather than a StatCluster. This is also the page's only
 * map — the destinations and routes on record are plotted straight onto
 * it, so there's no second, redundant "Map" section further down. */
export function AreaHero({
  area,
  designationLabel,
  className = "",
}: {
  area: AreaDetail;
  designationLabel: string;
  className?: string;
}) {
  return (
    <div className={`rounded-media relative isolate overflow-hidden ${className}`.trim()}>
      <AreaMap
        areaId={area.id}
        name={area.name}
        lat={area.lat}
        lng={area.lng}
        bbox={area.bbox}
        boundary={area.boundary}
        destinations={area.destinations}
        routes={area.routes}
        className="h-[260px] sm:h-[320px] lg:h-[380px]"
      />
      {/* z-[750] clears every Leaflet pane the scrim has to cover (tiles
          200, overlay 400, marker 600, popup 700) and stays under the
          control layer at 1000, so the layer switcher and tile attribution
          stay clickable. */}
      <div className="from-page via-page/85 pointer-events-none absolute inset-x-0 bottom-0 z-[750] bg-gradient-to-t to-transparent px-5 pt-16 pb-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
          {designationLabel}
        </p>
      </div>
    </div>
  );
}
