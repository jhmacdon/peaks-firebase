"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getAreaPersonalActivity,
  type AreaPersonalActivity,
} from "../../lib/actions/areas";
import { useAuth } from "../../lib/auth-context";
import {
  formatElapsed,
  formatFeetValue,
  formatMilesValue,
  formatShortDate,
} from "../../lib/destination-detail";
import { sessionActivityLabel } from "../../lib/session-track";
import { StatCluster } from "../ui/stat";

/** What you personally have done in this area — the only part of the page
 * that depends on who's reading it, so it stays a client island while the
 * rest of the area page renders on the server (same contract as
 * components/destination/destination-activity.tsx). */
export function AreaActivity({
  areaId,
  className = "",
}: {
  areaId: string;
  className?: string;
}) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const userId = user?.uid ?? null;
  const [activity, setActivity] = useState<AreaPersonalActivity | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!userId) {
      setActivity(null);
      return;
    }

    getIdToken()
      .then((token) => (token ? getAreaPersonalActivity(token, areaId, 5) : null))
      .then((result) => {
        if (!cancelled) setActivity(result);
      })
      .catch(() => {
        if (!cancelled) setActivity(null);
      });

    return () => {
      cancelled = true;
    };
  }, [areaId, authLoading, getIdToken, userId]);

  // A signed-in reader who's never been here has no activity to show — the
  // section omits itself rather than printing a row of zeros.
  if (!activity || activity.visit_count === 0) return null;

  const distance = formatMilesValue(activity.total_distance);
  const gain = formatFeetValue(activity.total_gain);
  const latestVisit = activity.latest_visit ? formatShortDate(activity.latest_visit) : null;

  return (
    <section className={className} aria-labelledby="area-personal-activity">
      <p
        id="area-personal-activity"
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
      {latestVisit ? <p className="mt-4 text-sm text-muted">Last visit {latestVisit}</p> : null}

      {activity.sessions.length > 0 ? (
        <ul className="mt-6 space-y-4">
          {activity.sessions.map((session) => {
            const label =
              session.name ||
              (session.destinationNames.length > 0
                ? session.destinationNames.join(", ")
                : "Untitled session");
            const date = new Date(session.start_time).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const distanceLabel =
              session.distance != null ? formatMilesValue(session.distance) : null;
            const meta = [
              sessionActivityLabel(session.activity_type),
              date,
              distanceLabel ? `${distanceLabel} mi` : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <li key={session.id}>
                <Link href={`/log/${session.id}`} className="group block">
                  <span className="block text-[15px] font-medium text-ink group-hover:underline">
                    {label}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">{meta}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
