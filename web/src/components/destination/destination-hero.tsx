import { StatCluster } from "../ui/stat";
import DestinationMap from "./destination-map-embed";

export type HeroPhoto = {
  url: string;
  credit: string | null;
  creditUrl: string | null;
};

export const MAP_ANCHOR_ID = "destination-map";

/** One rounded slab with 8px seams, the map treated as a photo — the move
 * lifted from the AllTrails trail page (audit §5, "Photos before stats; the
 * map treated as a photo").
 *
 * Three shapes, by how much imagery the record actually has:
 *   0 photos  the map fills the slab and carries the elevation, and IS the
 *             page's live map — see `mapIsInteractive` below
 *   1 photo   photo two-thirds, still map tile one-third
 *   2+ photos photo two-thirds, second photo over the still map tile
 *
 * `mapIsInteractive` is the important one. Nearly every catalog page has no
 * photo today, so nearly every page's hero is the map; rendering a second,
 * identical map in the section below would repeat the page's biggest
 * element and double the tile fetches against OpenTopoMap. So when the map
 * is the hero it is the live map, the anchor lands here, and the caller
 * drops its own map section (keeping only the coordinates row). When a
 * photo pushes the map down to a tile, that tile is a still preview linking
 * to the live map further down.
 */
export function DestinationHero({
  name,
  photos,
  lat,
  lng,
  boundary,
  elevationValue,
  className = "",
}: {
  name: string;
  photos: HeroPhoto[];
  lat: number | null;
  lng: number | null;
  boundary: GeoJSON.Polygon | null;
  elevationValue: string | null;
  className?: string;
}) {
  const hasMap = lat != null && lng != null;
  const [lead, second] = photos;

  if (!lead && !hasMap) return null;

  // ── Map-only hero: the live map, elevation on a scrim at its foot.
  if (!lead && hasMap) {
    return (
      <div
        id={MAP_ANCHOR_ID}
        className={`rounded-media relative isolate overflow-hidden ${className}`.trim()}
      >
        <DestinationMap
          lat={lat}
          lng={lng}
          name={name}
          boundary={boundary}
          className="h-[260px] sm:h-[320px] lg:h-[380px]"
        />
        {elevationValue ? (
          // z-750 clears every Leaflet pane the scrim has to cover — tiles
          // 200, overlay 400, shadow 500, marker 600, tooltip 650, popup
          // 700 — and stays under the control layer at 1000, so the tile
          // attribution keeps sitting on top of the scrim rather than being
          // painted over.
          <div className="from-page via-page/85 pointer-events-none absolute inset-x-0 bottom-0 z-[750] bg-gradient-to-t to-transparent px-5 pt-16 pb-4">
            <StatCluster
              scale="page"
              value={elevationValue}
              unit="ft"
              label="Elevation"
            />
          </div>
        ) : null}
      </div>
    );
  }

  const sideTiles = [
    // Decorative: a second view of the same place, already named by the
    // lead tile's alt text — repeating the name would just make a screen
    // reader say it twice.
    second ? <PhotoTile key="photo-2" photo={second} alt="" /> : null,
    hasMap ? (
      <MapPreviewTile key="map" name={name} lat={lat} lng={lng} boundary={boundary} />
    ) : null,
  ].filter(Boolean);

  return (
    <div
      className={`rounded-media grid gap-2 overflow-hidden sm:h-[320px] lg:h-[380px] ${
        sideTiles.length > 0 ? "sm:grid-cols-[2fr_1fr]" : ""
      } ${className}`.trim()}
    >
      <PhotoTile photo={lead} alt={name} className="h-[240px] sm:h-full" />
      {sideTiles.length > 0 ? (
        <div
          className={`grid h-[120px] gap-2 sm:h-full ${
            sideTiles.length > 1 ? "grid-cols-2 sm:grid-cols-1 sm:grid-rows-2" : ""
          }`}
        >
          {sideTiles}
        </div>
      ) : null}
    </div>
  );
}

function PhotoTile({
  photo,
  alt,
  className = "",
}: {
  photo: HeroPhoto;
  alt: string;
  className?: string;
}) {
  return (
    <figure className={`bg-fill relative h-full overflow-hidden ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={alt} className="h-full w-full object-cover" />
      {photo.credit ? (
        <figcaption className="photo-credit absolute inset-x-0 bottom-0 px-3 pt-8 pb-1.5 text-right text-[11px]">
          Photo:{" "}
          {photo.creditUrl ? (
            <a
              href={photo.creditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {photo.credit}
            </a>
          ) : (
            photo.credit
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}

function MapPreviewTile({
  name,
  lat,
  lng,
  boundary,
}: {
  name: string;
  lat: number;
  lng: number;
  boundary: GeoJSON.Polygon | null;
}) {
  return (
    <div className="relative isolate h-full overflow-hidden">
      <DestinationMap
        lat={lat}
        lng={lng}
        name={name}
        boundary={boundary}
        interactive={false}
        className="h-full"
      />
      {/* Sits over the Leaflet pane rather than wrapping it — a click on a
          tile inside an anchor doesn't reliably reach the anchor. Above
          every map pane (400/600), stopping short of the bottom strip so
          the tile attribution stays clickable. */}
      <a
        href={`#${MAP_ANCHOR_ID}`}
        className="absolute inset-x-0 top-0 bottom-4 z-[900]"
        aria-label={`See ${name} on the map`}
      />
    </div>
  );
}
