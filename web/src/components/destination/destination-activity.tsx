"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getUserDestinationActivity, type DestinationUserActivity } from "../../lib/actions/destinations";
import { formatElapsed, formatFeetValue, formatMilesValue, formatShortDate } from "../../lib/destination-detail";
import { useAuth } from "../../lib/auth-context";
import { sessionActivityLabel } from "../../lib/session-track";
import { Button } from "../ui/button";
import { SectionHeading } from "../ui/section-heading";

const ActivityContext = createContext<{ activity: DestinationUserActivity | null; error: boolean; retry: () => void }>({ activity: null, error: false, retry: () => {} });

export function DestinationActivityProvider({ destinationId, children }: { destinationId: string; children: ReactNode }) {
  const { user, loading, getIdToken } = useAuth();
  const [activity, setActivity] = useState<DestinationUserActivity | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const userId = user?.uid;
  useEffect(() => {
    let cancelled = false;
    setActivity(null);
    setError(false);
    if (loading || !userId) return;
    getIdToken().then((token) => {
      if (!token) throw new Error("Sign in again to see your activity");
      return getUserDestinationActivity(token, destinationId);
    }).then((result) => { if (!cancelled) setActivity(result); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [destinationId, userId, loading, getIdToken, attempt]);
  return <ActivityContext.Provider value={{ activity, error, retry: () => setAttempt((value) => value + 1) }}>{children}</ActivityContext.Provider>;
}

export function DestinationActivity({ className = "" }: { className?: string }) {
  const { activity, error, retry } = useContext(ActivityContext);
  if (error) return <div role="status" className={`my-5 text-sm text-muted ${className}`}>Your activity could not load. <Button variant="quiet" onClick={retry}>Retry</Button></div>;
  if (!activity?.visit_count) return null;
  const latest = activity.sessions[0];
  const facts = [
    `${formatMilesValue(activity.total_distance)} mi`,
    `${formatFeetValue(activity.total_gain)} ft gained`,
    `${formatElapsed(activity.total_time)} moving`,
  ];
  return (
    <section aria-label="Your activity" className={`rounded-media border border-border bg-surface p-5 sm:p-6 ${className}`}>
      <p className="text-sm text-muted">Your activity</p>
      <p className="mt-2 text-2xl font-semibold text-ink">{activity.visit_count.toLocaleString()} {activity.visit_count === 1 ? "visit" : "visits"}</p>
      {latest ? <Link href={`/log/${latest.id}`} className="mt-2 block text-sm text-ink-2 hover:underline">Latest: {latest.name || sessionActivityLabel(latest.activity_type)} · {formatShortDate(latest.start_time)}</Link> : null}
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">{facts.map((fact) => <span key={fact}>{fact}</span>)}</p>
    </section>
  );
}

export function DestinationSessions() {
  const { activity } = useContext(ActivityContext);
  if (!activity?.sessions.length) return null;
  return (
    <section id="destination-sessions" className="scroll-mt-24">
      <SectionHeading>Your recent sessions</SectionHeading>
      <ul className="mt-4 divide-y divide-hairline">
        {activity.sessions.map((session) => <li key={session.id}>
          <Link href={`/log/${session.id}`} className="block py-4 hover:text-accent-text">
            <span className="font-medium">{session.name || sessionActivityLabel(session.activity_type)}</span>
            <span className="mt-1 block text-sm text-muted">{sessionActivityLabel(session.activity_type)} · {formatShortDate(session.start_time)}{session.distance != null ? ` · ${formatMilesValue(session.distance)} mi` : ""}</span>
          </Link>
        </li>)}
      </ul>
    </section>
  );
}
