"use client";

import {
  formatElapsed,
  formatFeetValue,
  formatMilesValue,
  formatShortDate,
} from "../../lib/destination-detail";
import { Button } from "../ui/button";
import ProgressBar from "../progress-bar";
import { StatCluster } from "../ui/stat";
import { useAreaPersonalization } from "./area-personalization";

/** One personal summary card: reached places lead, recent context follows,
 * and distance, gain, and time stay in one compact row. */
export function AreaActivity({
  destinationCount,
  className = "",
}: {
  destinationCount: number;
  className?: string;
}) {
  const { activity, loading, signedIn, error, retry } = useAreaPersonalization();

  if (!signedIn) return null;

  if (loading && !activity) {
    return (
      <section
        className={`rounded-media border border-border bg-surface p-5 ${className}`.trim()}
        aria-labelledby="area-personal-activity"
        aria-live="polite"
      >
        <p
          id="area-personal-activity"
          className="text-sm text-muted"
        >
          Your activity
        </p>
        <p className="mt-4 text-sm text-muted">Loading your climbs…</p>
      </section>
    );
  }

  if (error) return <p role="status" className="text-sm text-muted">Your area activity could not load. <Button variant="quiet" onClick={retry}>Retry</Button></p>;
  if (!activity) return null;

  const reachedCount = Object.keys(activity.reached_destinations).length;
  const distance = formatMilesValue(activity.total_distance);
  const gain = formatFeetValue(activity.total_gain);
  const latestVisit = activity.latest_visit ? formatShortDate(activity.latest_visit) : null;

  return (
    <section
      className={`rounded-media border border-border bg-surface p-5 sm:p-6 ${className}`.trim()}
      aria-labelledby="area-personal-activity"
    >
      <p
        id="area-personal-activity"
        className="text-sm text-muted"
      >
        Your activity
      </p>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <StatCluster
          scale="page"
          value={reachedCount.toLocaleString("en-US")}
          unit={`of ${destinationCount.toLocaleString("en-US")}`}
          label="Peaks and places reached"
        />
        <p className="text-sm text-muted">
          {latestVisit ? `Last visit ${latestVisit}` : "No recorded climbs here yet"}
        </p>
      </div>

      {destinationCount > 0 ? (
        <ProgressBar
          completed={reachedCount}
          total={destinationCount}
          className="mt-5 max-w-xl"
        />
      ) : null}

      <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
        <span>{activity.visit_count.toLocaleString()} {activity.visit_count === 1 ? "visit" : "visits"}</span>
        {distance ? <span>{distance} mi</span> : null}
        {gain ? <span>{gain} ft gained</span> : null}
        {activity.total_time > 0 ? <span>{formatElapsed(activity.total_time)} moving</span> : null}
      </p>
    </section>
  );
}
