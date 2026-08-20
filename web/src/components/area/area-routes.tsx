import Link from "next/link";
import type { AreaRoute } from "../../lib/actions/areas";
import { formatDurationRangeFriendly, formatSessionCount } from "../../lib/format";
import { formatFeet, formatMiles } from "../../lib/destination-detail";
import { summarizeRouteGuide } from "../../lib/route-guide";
import { SectionHeading } from "../ui/section-heading";

/** Routes that pass through the area — quiet rows, same shape as
 * DestinationRoutes (components/destination/destination-routes.tsx).
 * Difficulty is a plain word in the meta line rather than a colored pill. */
export function AreaRoutes({
  routes,
  totalCount,
  className = "",
}: {
  routes: AreaRoute[];
  totalCount: number;
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="area-routes">
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading>
          <span id="area-routes">Routes through here</span>
        </SectionHeading>
        {totalCount > routes.length ? (
          <span className="text-[13px] text-muted">
            Showing {routes.length} of {totalCount.toLocaleString("en-US")}
          </span>
        ) : null}
      </div>
      {routes.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No public routes are linked to this area yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {routes.map((route) => {
            const hasStats = route.distance != null || route.gain != null;
            const summary = hasStats
              ? summarizeRouteGuide({
                  distance: route.distance,
                  gain: route.gain,
                  gain_loss: null,
                  shape: route.shape,
                  completion: "none",
                  destination_count: route.destination_count,
                })
              : null;

            const metaParts = [
              summary?.difficultyLabel ?? null,
              route.distance != null ? formatMiles(route.distance) : null,
              route.gain != null ? `${formatFeet(route.gain)} gain` : null,
              route.session_count > 0 ? formatSessionCount(route.session_count) : null,
              summary?.estimatedHoursLow != null
                ? `Est. ${formatDurationRangeFriendly(summary.estimatedHoursLow, summary.estimatedHoursHigh)}`
                : null,
            ].filter((part): part is string => Boolean(part));

            return (
              <li key={route.id}>
                <Link href={`/routes/${route.id}`} className="group block">
                  <span className="block text-[15px] font-medium text-ink group-hover:underline">
                    {route.name || "Unnamed route"}
                  </span>
                  {metaParts.length > 0 ? (
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {metaParts.join(" · ")}
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
