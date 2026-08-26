"use client";

import {
  formatElapsed,
  formatFeetValue,
  formatMilesValue,
  formatShortDate,
} from "../../lib/destination-detail";
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
  const { activity, loading, signedIn } = useAreaPersonalization();

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
          className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase"
        >
          Your activity
        </p>
        <p className="mt-4 text-sm text-muted">Loading your climbs…</p>
      </section>
    );
  }

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
        className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase"
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

      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5">
        <StatCluster
          scale="card"
          value={activity.visit_count.toLocaleString("en-US")}
          label={activity.visit_count === 1 ? "Visit" : "Visits"}
        />
        {distance ? (
          <StatCluster scale="card" value={distance} unit="mi" label="Distance" />
        ) : null}
        {gain ? <StatCluster scale="card" value={gain} unit="ft" label="Gain" /> : null}
        {activity.total_time > 0 ? (
          <StatCluster
            scale="card"
            value={formatElapsed(activity.total_time)}
            label="Moving time"
          />
        ) : null}
      </div>
    </section>
  );
}
