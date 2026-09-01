import RouteMap from "./route-map-embed";

export type RouteCoverPhoto = {
  url: string;
  attribution: string;
  attributionUrl: string;
  focalX: number;
  focalY: number;
};

/** The route's credited destination cover beside its live map. The map keeps
 * the whole slab when no fully credited linked photo is available. */
export function RouteHero({
  name,
  polyline6,
  cover,
  className = "",
}: {
  name: string;
  polyline6: string | null;
  cover: RouteCoverPhoto | null;
  className?: string;
}) {
  if (!cover) {
    if (!polyline6) return null;
    return (
      <div className={`rounded-media relative isolate overflow-hidden ${className}`.trim()}>
        <RouteMap polyline6={polyline6} className="h-[260px] sm:h-[320px] lg:h-[380px]" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-media grid gap-2 overflow-hidden sm:h-[320px] lg:h-[380px] ${
        polyline6 ? "sm:grid-cols-[2fr_1fr]" : ""
      } ${className}`.trim()}
    >
      <figure className="bg-fill relative h-[240px] overflow-hidden sm:h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover.url}
          alt={name}
          className="h-full w-full object-cover"
          style={{ objectPosition: `${cover.focalX}% ${cover.focalY}%` }}
        />
        <figcaption className="photo-credit absolute inset-x-0 bottom-0 px-3 pt-8 pb-1.5 text-right text-[11px]">
          Photo:{" "}
          <a
            href={cover.attributionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {cover.attribution}
          </a>
        </figcaption>
      </figure>
      {polyline6 ? (
        <RouteMap polyline6={polyline6} className="h-[120px] sm:h-full" />
      ) : null}
    </div>
  );
}
