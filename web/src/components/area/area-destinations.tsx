import Link from "next/link";
import type { AreaDestination } from "../../lib/actions/areas";
import { describeDestinationType, formatFeetValue } from "../../lib/destination-detail";
import { SectionHeading } from "../ui/section-heading";

/** Peaks and destinations inside the boundary — quiet rows, name over
 * elevation + feature word, same shape as DestinationNearby
 * (components/destination/destination-nearby.tsx). */
export function AreaDestinations({
  destinations,
  totalCount,
  className = "",
}: {
  destinations: AreaDestination[];
  totalCount: number;
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="area-destinations">
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading>
          <span id="area-destinations">Peaks and destinations</span>
        </SectionHeading>
        {totalCount > destinations.length ? (
          <span className="text-[13px] text-muted">
            Showing {destinations.length} of {totalCount.toLocaleString("en-US")}
          </span>
        ) : null}
      </div>
      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No catalog destinations are linked to this area yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {destinations.map((destination) => {
            const elevation = formatFeetValue(destination.elevation);
            const typeLabel = describeDestinationType(destination.type, destination.features);

            return (
              <li key={destination.id}>
                <Link href={`/destinations/${destination.id}`} className="group block">
                  <span className="block text-[15px] font-medium text-ink group-hover:underline">
                    {destination.name || "Unnamed"}
                  </span>
                  {elevation || typeLabel ? (
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {elevation ? (
                        <span className="font-mono-num tabular-nums">{elevation} ft</span>
                      ) : null}
                      {elevation && typeLabel ? " · " : null}
                      {typeLabel}
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
