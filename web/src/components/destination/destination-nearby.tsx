import Link from "next/link";
import {
  describeDestinationType,
  formatDistanceAway,
  formatFeetValue,
} from "../../lib/destination-detail";
import type { SearchDestination } from "../../lib/actions/search";

/** AllTrails' "Top sights" rows (audit §4), rebuilt on Peaks data: a 48px
 * round thumb where the record has a photo, the name, then the elevation in
 * Geist Mono and the feature word. No card, no border — the thumb is the
 * only shape in the row. */
export function DestinationNearby({
  destinations,
  className = "",
}: {
  destinations: SearchDestination[];
  className?: string;
}) {
  if (destinations.length === 0) return null;

  return (
    <section className={className} aria-labelledby="destination-nearby">
      <h2
        id="destination-nearby"
        className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase"
      >
        Nearby
      </h2>
      <ul className="mt-4 space-y-4">
        {destinations.map((destination) => {
          const elevation = formatFeetValue(destination.elevation);
          const typeLabel = describeDestinationType(
            destination.type,
            destination.features
          );
          // Elevation is the only numeral here, so it's the only thing in
          // Geist Mono — the type word and the distance phrase stay in the
          // text face.
          const words = [
            typeLabel,
            destination.distance_m != null
              ? formatDistanceAway(destination.distance_m)
              : null,
          ].filter(Boolean);

          return (
            <li key={destination.id}>
              <Link href={`/destinations/${destination.id}`} className="group flex gap-3">
                {destination.hero_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={destination.hero_image}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full bg-fill object-cover"
                    style={{
                      objectPosition: `${destination.hero_image_focal_x ?? 50}% ${destination.hero_image_focal_y ?? 50}%`,
                    }}
                  />
                ) : null}
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-ink group-hover:underline">
                    {destination.name || "Unnamed"}
                  </span>
                  {elevation || words.length > 0 ? (
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {elevation ? (
                        <span className="font-mono-num tabular-nums">{elevation} ft</span>
                      ) : null}
                      {elevation && words.length > 0 ? " · " : null}
                      {words.join(" · ")}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
