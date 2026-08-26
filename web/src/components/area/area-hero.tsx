"use client";

import type { AreaDetail } from "../../lib/actions/areas";
import AreaMap from "./area-map-embed";
import { useAreaPersonalization } from "./area-personalization";

/** A place-led hero: the best reviewed destination photo fills the lead
 * tile and the live satellite map stays beside it. Areas without a linked
 * photo keep the live map full width. */
export function AreaHero({
  area,
  className = "",
}: {
  area: AreaDetail;
  className?: string;
}) {
  const { activity, signedIn } = useAreaPersonalization();
  const reachedDestinationIds = activity
    ? Object.keys(activity.reached_destinations)
    : [];
  const photoDestination = area.destinations.find(
    (destination) => destination.hero_image != null
  );

  const map = (
    <AreaMap
      areaId={area.id}
      name={area.name}
      lat={area.lat}
      lng={area.lng}
      bbox={area.bbox}
      boundary={area.boundary}
      destinations={area.destinations}
      routes={area.routes}
      reachedDestinationIds={reachedDestinationIds}
      showCompletion={signedIn && activity != null}
      className={photoDestination ? "h-[220px] sm:h-full" : "h-[300px] sm:h-[360px] lg:h-[420px]"}
    />
  );

  if (!photoDestination?.hero_image) {
    return (
      <div className={`rounded-media relative isolate overflow-hidden ${className}`.trim()}>
        {map}
      </div>
    );
  }

  return (
    <div
      className={`rounded-media grid gap-2 overflow-hidden sm:h-[360px] sm:grid-cols-[3fr_2fr] lg:h-[420px] ${className}`.trim()}
    >
      <figure className="relative h-[260px] overflow-hidden bg-fill sm:h-full">
        {/* The photo names the featured peak because the page title already names the area. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoDestination.hero_image}
          alt={`${photoDestination.name || "Mountain landscape"} in ${area.name}`}
          className="h-full w-full object-cover"
          style={{
            objectPosition: `${photoDestination.hero_image_focal_x}% ${photoDestination.hero_image_focal_y}%`,
          }}
        />
        <div className="from-page via-page/85 absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t to-transparent px-5 pt-16 pb-4">
          <p className="text-sm font-medium text-ink">
            {photoDestination.name || area.name}
          </p>
          {photoDestination.hero_image_attribution ? (
            <figcaption className="photo-credit max-w-[60%] px-2 py-1 text-right text-[11px]">
              Photo: {photoDestination.hero_image_attribution_url ? (
                <a
                  href={photoDestination.hero_image_attribution_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {photoDestination.hero_image_attribution}
                </a>
              ) : (
                photoDestination.hero_image_attribution
              )}
            </figcaption>
          ) : null}
        </div>
      </figure>
      <div className="isolate overflow-hidden">{map}</div>
    </div>
  );
}
