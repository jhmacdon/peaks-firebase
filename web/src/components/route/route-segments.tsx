import { formatDistanceMeters, formatElevationMeters } from "../../lib/route-guide";
import type { RouteSegment } from "../../lib/actions/routes";
import { SectionHeading } from "../ui/section-heading";

/** The atomic trail sections this route is built from — only rendered when
 * the route actually decomposes into more than one, since a single-segment
 * route would just repeat the topline's own distance and gain. */
export function RouteSegments({
  segments,
  className = "",
}: {
  segments: RouteSegment[];
  className?: string;
}) {
  if (segments.length === 0) return null;

  return (
    <section className={className} aria-labelledby="route-segments">
      <SectionHeading>
        <span id="route-segments">Segments ({segments.length})</span>
      </SectionHeading>
      <ol className="mt-4 divide-y divide-hairline border-y border-hairline">
        {segments.map((segment) => (
          <li
            key={`${segment.id}-${segment.ordinal}`}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="min-w-0">
              <div className="font-medium text-ink">
                {segment.name || `Segment ${segment.ordinal + 1}`}
              </div>
              <div className="mt-0.5 text-[13px] text-muted">
                {[
                  formatDistanceMeters(segment.distance),
                  segment.gain != null ? `${formatElevationMeters(segment.gain)} gain` : null,
                  segment.direction === "reverse" ? "Reversed" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {segment.route_count > 1 ? (
              <span className="shrink-0 text-xs text-muted">
                Shared by {segment.route_count} routes
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
