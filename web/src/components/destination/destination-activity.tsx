"use client";

import { useEffect, useState } from "react";
import {
  getUserDestinationActivity,
  type DestinationUserActivity,
} from "../../lib/actions/destinations";
import {
  formatElapsed,
  formatFeetValue,
  formatMilesValue,
  formatShortDate,
} from "../../lib/destination-detail";
import { useAuth } from "../../lib/auth-context";
import { StatCluster } from "../ui/stat";

/** What you personally have done here — the only part of the page that
 * depends on who is reading it, so it stays a client island while the rest
 * of the destination page renders on the server.
 *
 * Same query and same five facts as before; what changed is the shell. It
 * used to be a tinted, bordered card with a divided three-cell grid inside
 * it — a box holding boxed stats, twice over. Now it's an eyebrow, a line
 * of numerals, and whitespace.
 */
export function DestinationActivity({
  destinationId,
  className = "",
}: {
  destinationId: string;
  className?: string;
}) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const userId = user?.uid ?? null;
  const [activity, setActivity] = useState<DestinationUserActivity | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!userId) {
      setActivity(null);
      return;
    }

    getIdToken()
      .then((token) => (token ? getUserDestinationActivity(token, destinationId) : null))
      .then((result) => {
        if (!cancelled) setActivity(result);
      })
      .catch(() => {
        if (!cancelled) setActivity(null);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, destinationId, getIdToken, userId]);

  // A signed-in reader who has never been here has no activity to show. The
  // old card rendered anyway, printing a row of zeros under "No recorded
  // visits yet" — the section now omits itself instead (plan constraint 6).
  if (!activity || activity.visit_count === 0) return null;

  const distance = formatMilesValue(activity.total_distance);
  const gain = formatFeetValue(activity.total_gain);
  const latestVisit = activity.latest_visit
    ? formatShortDate(activity.latest_visit)
    : null;

  return (
    <section className={className} aria-labelledby="destination-personal-activity">
      <p
        id="destination-personal-activity"
        className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase"
      >
        Your activity
      </p>
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-5">
        <StatCluster
          scale="card"
          value={activity.visit_count.toLocaleString("en-US")}
          label={activity.visit_count === 1 ? "Visit" : "Visits"}
        />
        {distance ? (
          <StatCluster scale="card" value={distance} unit="mi" label="Distance" />
        ) : null}
        {gain ? <StatCluster scale="card" value={gain} unit="ft" label="Gain" /> : null}
        <StatCluster
          scale="card"
          value={formatElapsed(activity.total_time)}
          label="Moving time"
        />
      </div>
      {latestVisit ? (
        <p className="mt-4 text-sm text-muted">Last visit {latestVisit}</p>
      ) : null}
    </section>
  );
}
