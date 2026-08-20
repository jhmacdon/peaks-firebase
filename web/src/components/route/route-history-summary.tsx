"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { getUserRouteHistory } from "../../lib/actions/routes";
import {
  bestSecondsFromAttempts,
  formatRouteHistoryHeadline,
  latestAttempt,
  type RouteAttempt,
} from "../../lib/route-history";
import { formatShortDate } from "../../lib/destination-detail";

/** "You've done this route 4 times · Best: 4h 12m" — a quiet one-liner, the
 * route page's analog of DestinationActivity. Signed-in only, and a client
 * island for the same reason: whether — and what — to show depends on who's
 * asking, which isn't known until Firebase Auth settles in the browser.
 * Absent for a signed-out reader, a failed fetch, or a route the user has
 * never done. Strictly the viewer's own history — never another user's. */
export function RouteHistorySummary({
  routeId,
  className = "",
}: {
  routeId: string;
  className?: string;
}) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const userId = user?.uid ?? null;
  const [attempts, setAttempts] = useState<RouteAttempt[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!userId) {
      setAttempts(null);
      return;
    }

    getIdToken()
      .then((token) => (token ? getUserRouteHistory(token, routeId) : null))
      .then((result) => {
        if (!cancelled) setAttempts(result ?? []);
      })
      .catch(() => {
        if (!cancelled) setAttempts(null);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, routeId, userId]);

  if (!attempts || attempts.length === 0) return null;

  const headline = formatRouteHistoryHeadline(
    attempts.length,
    bestSecondsFromAttempts(attempts)
  );
  const latest = latestAttempt(attempts);
  if (!headline || !latest) return null;

  return (
    <p className={`text-sm text-ink-2 ${className}`.trim()}>
      {headline}
      {" — "}
      <Link
        href={`/log/${latest.sessionId}`}
        className="text-muted underline decoration-border underline-offset-2 hover:text-ink-2"
      >
        latest {formatShortDate(latest.startTime)}
      </Link>
    </p>
  );
}
