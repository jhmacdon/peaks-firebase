import Link from "next/link";
import type { ListDestination } from "../../lib/actions/lists";
import { formatFeetValue, titleize } from "../../lib/destination-detail";
import { SectionHeading } from "../ui/section-heading";

/** The destinations on this list — quiet rows, elevation in Geist Mono,
 * same shape as DestinationNearby
 * (components/destination/destination-nearby.tsx). Sorted by elevation
 * descending server-side (lib/actions/lists.ts), so the highest entries
 * lead. */
export function ListDestinations({
  destinations,
  className = "",
}: {
  destinations: ListDestination[];
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="list-destinations">
      <SectionHeading>
        <span id="list-destinations">
          Destinations{destinations.length > 0 ? ` (${destinations.length})` : ""}
        </span>
      </SectionHeading>
      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">This list has no destinations yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {destinations.map((destination) => {
            const elevation = formatFeetValue(destination.elevation);
            const featureWord = destination.features[0] ? titleize(destination.features[0]) : null;

            return (
              <li key={destination.id}>
                <Link href={`/destinations/${destination.id}`} className="group block">
                  <span className="block text-[15px] font-medium text-ink group-hover:underline">
                    {destination.name || "Unnamed"}
                  </span>
                  {elevation || featureWord ? (
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {elevation ? (
                        <span className="font-mono-num tabular-nums">{elevation} ft</span>
                      ) : null}
                      {elevation && featureWord ? " · " : null}
                      {featureWord}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
