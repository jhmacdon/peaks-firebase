"use client";

import { useState } from "react";
import { getAreaRoutePage } from "../../lib/actions/areas";
import { Button } from "../ui/button";
import Link from "next/link";
import type { AreaRoute } from "../../lib/actions/areas";
import { formatDurationRangeFriendly, formatSessionCount } from "../../lib/format";
import { formatFeet, formatMiles } from "../../lib/destination-detail";
import { getRouteTraversalMetrics, summarizeRouteGuide } from "../../lib/route-guide";
import { SectionHeading } from "../ui/section-heading";

/** Routes that pass through the area — quiet rows, same shape as
 * DestinationRoutes (components/destination/destination-routes.tsx).
 * Difficulty is a plain word in the meta line rather than a colored pill. */
export function AreaRoutes({
  areaId,
  routes: initialRoutes,
  totalCount,
  className = "",
}: {
  areaId: string;
  routes: AreaRoute[];
  totalCount: number;
  className?: string;
}) {
  const [routes, setRoutes] = useState(initialRoutes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function loadMore() {
    setLoading(true); setError(false);
    try { const next = await getAreaRoutePage(areaId, routes.length); setRoutes((current) => [...current, ...next]); }
    catch { setError(true); }
    finally { setLoading(false); }
  }
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
                  gain_loss: route.gain_loss,
                  shape: route.shape,
                  completion: route.completion,
                  destination_count: route.destination_count,
                })
              : null;

            const traversal = getRouteTraversalMetrics({ ...route, gain_loss: route.gain_loss });
            const isLongTrail = (traversal.distanceMeters ?? 0) > 80000;
            const distanceScope = route.shape === "out_and_back" ? "round trip" : route.shape === "point_to_point" ? "one way" : "full route";
            const metaParts = [
              !isLongTrail ? summary?.difficultyLabel ?? null : "Long-distance trail",
              traversal.distanceMeters != null ? `${formatMiles(traversal.distanceMeters)} ${distanceScope}` : null,
              traversal.gainMeters != null ? `${formatFeet(traversal.gainMeters)} gain` : null,
              route.session_count > 0 ? formatSessionCount(route.session_count) : null,
              !isLongTrail && summary?.estimatedHoursLow != null
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
                {isLongTrail ? <p className="mt-1 text-sm text-muted">This trail crosses the area. These facts cover the whole trail; an in-area segment is not available.</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p role="alert" className="mt-4 text-sm text-alert">More routes could not load. Try again.</p> : null}
      {routes.length < totalCount ? <Button variant="secondary" className="mt-5" disabled={loading} onClick={loadMore}>{loading ? "Loading routes…" : error ? "Retry" : "Show more routes"}</Button> : null}
    </section>
  );
}
