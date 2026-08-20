import { SectionHeading } from "../ui/section-heading";
import { MAP_ANCHOR_ID } from "./destination-hero";
import DestinationMap from "./destination-map-embed";
import { DestinationMapLinks } from "./destination-map-links";

/** The live map, in one 16px-radius container with a flat interior — the
 * page's only bordered surface, and nothing is nested inside it.
 *
 * Rendered only when a photo pushed the map out of the hero. When the hero
 * IS the map (no photos, which is most of the catalog) the caller skips
 * this section and prints the coordinates row under the hero instead —
 * there is no reason to draw the same map twice on one page.
 */
export function DestinationMapSection({
  name,
  lat,
  lng,
  boundary,
  className = "",
}: {
  name: string | null;
  lat: number | null;
  lng: number | null;
  boundary: GeoJSON.Polygon | null;
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="destination-map-heading">
      <SectionHeading>
        <span id="destination-map-heading">Map</span>
      </SectionHeading>
      {lat != null && lng != null ? (
        <>
          {/* `isolate` keeps Leaflet's 400-1000 pane stack from ever
              reaching over the app's chrome — the containment the map
              component used to do with its own z-0. */}
          <div id={MAP_ANCHOR_ID} className="rounded-media mt-4 isolate overflow-hidden">
            <DestinationMap
              lat={lat}
              lng={lng}
              name={name}
              boundary={boundary}
              className="h-[320px] sm:h-[420px]"
            />
          </div>
          <DestinationMapLinks lat={lat} lng={lng} className="mt-3" />
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">
          No coordinates are saved for this destination yet.
        </p>
      )}
    </section>
  );
}
