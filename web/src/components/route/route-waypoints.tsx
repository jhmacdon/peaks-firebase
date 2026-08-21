import Link from "next/link";
import { titleize } from "../../lib/destination-detail";
import type { RouteDestination } from "../../lib/actions/routes";
import { SectionHeading } from "../ui/section-heading";

/** The destinations strung along the route, in order — Start / Finish
 * labeled, everything between just "Waypoint N". Hairline-divided rows
 * (a row list, not a card grid — law 3: sections separate by whitespace,
 * rows inside a section by a hairline). */
export function RouteWaypoints({
  destinations,
  className = "",
}: {
  destinations: RouteDestination[];
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="route-waypoints">
      <SectionHeading>
        <span id="route-waypoints">
          Waypoints{destinations.length > 0 ? ` (${destinations.length})` : ""}
        </span>
      </SectionHeading>
      {destinations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No destinations are linked to this route yet.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-hairline border-y border-hairline">
          {destinations.map((dest, index) => {
            const metaParts = [
              dest.elevation != null
                ? `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`
                : null,
              ...(Array.isArray(dest.features) ? dest.features.map(titleize) : []),
            ].filter((part): part is string => Boolean(part));

            return (
              <li key={dest.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/destinations/${dest.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {dest.name || "Waypoint"}
                  </Link>
                  {metaParts.length > 0 ? (
                    <div className="mt-0.5 text-[13px] text-muted">
                      {metaParts.join(" · ")}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-medium text-muted">
                  {index === 0
                    ? "Start"
                    : index === destinations.length - 1
                      ? "Finish"
                      : `Waypoint ${index}`}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
