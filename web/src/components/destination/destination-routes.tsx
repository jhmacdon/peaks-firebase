import Link from "next/link";
import { formatDurationRangeFriendly } from "../../lib/format";
import { formatFeet, formatMiles } from "../../lib/destination-detail";
import { summarizeRouteGuide } from "../../lib/route-guide";
import type { DestinationRoute } from "../../lib/actions/destinations";
import { SectionHeading } from "../ui/section-heading";

/** Quiet rows: route name, then one middle-dot meta line.
 *
 * Difficulty is a plain word in that meta line rather than a coloured pill.
 * AllTrails doesn't colour-code difficulty either (audit §2) — and a page
 * whose whole accent budget is one Save button can't spend four more hues
 * on a heuristic guess.
 */
export function DestinationRoutes({
  routes,
  className = "",
}: {
  routes: DestinationRoute[];
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="destination-routes">
      <SectionHeading>
        <span id="destination-routes">Routes</span>
      </SectionHeading>
      {routes.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No routes are linked to this destination yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {routes.map((route) => (
            <RouteRow key={route.id} route={route} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RouteRow({ route }: { route: DestinationRoute }) {
  const hasStats = route.distance != null || route.gain != null;
  const summary = hasStats
    ? summarizeRouteGuide({
        distance: route.distance,
        gain: route.gain,
        gain_loss: null,
        shape: null,
        completion: "none",
        destination_count: 0,
      })
    : null;

  const metaParts = [
    summary?.difficultyLabel ?? null,
    route.distance != null ? formatMiles(route.distance) : null,
    route.gain != null ? `${formatFeet(route.gain)} gain` : null,
    summary?.estimatedHoursLow != null
      ? `Est. ${formatDurationRangeFriendly(summary.estimatedHoursLow, summary.estimatedHoursHigh)}`
      : null,
  ].filter(Boolean);

  return (
    <li>
      <Link href={`/routes/${route.id}`} className="group block">
        <span className="block text-base font-medium text-ink group-hover:underline">
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
}
