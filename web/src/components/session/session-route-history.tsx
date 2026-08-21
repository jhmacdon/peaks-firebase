"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { getUserRouteHistoryBatch } from "../../lib/actions/routes";
import type { SessionRoute } from "../../lib/actions/sessions";
import {
  ordinalLabel,
  pickFeaturedRoute,
  shapeRouteHistory,
  type RouteHistorySummary,
} from "../../lib/route-history";
import { formatDurationValue } from "../../lib/session-detail";
import { formatShortDate } from "../../lib/destination-detail";
import { SectionHeading } from "../ui/section-heading";
import { Badge } from "../ui/badge";

interface FeaturedHistory {
  routeId: string;
  routeName: string | null;
  history: RouteHistorySummary;
}

/** "Your history on this route" — the owner's prior attempts at whichever
 * matched route they've done most, framed Strava-style as participation
 * ("3rd of your 5 attempts") rather than a bare rank. Owner-only: the
 * caller renders this only when `userId === session.user_id`, and the
 * server action re-verifies that server-side by scoping every row to the
 * caller's own uid — there is no path to another user's sessions here.
 *
 * A self-contained client island, same shape as DestinationActivity: a
 * failed fetch (or a session with no matched route, or a route the user has
 * only ever attempted once) just omits the section rather than showing an
 * error or a trivial "1st of your 1 attempts". */
export function SessionRouteHistory({
  sessionId,
  routes,
  className = "",
}: {
  sessionId: string;
  routes: SessionRoute[];
  className?: string;
}) {
  const { getIdToken } = useAuth();
  const routeKey = routes.map((route) => route.id).join(",");
  const [featured, setFeatured] = useState<FeaturedHistory | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (routes.length === 0) {
      setFeatured(null);
      return;
    }

    async function load() {
      try {
        const token = await getIdToken();
        if (!token) {
          if (!cancelled) setFeatured(null);
          return;
        }

        // One round trip for every matched route, not one per route — a
        // session can match up to 10 in production (Important 1, review
        // fix wave).
        const historyByRoute = await getUserRouteHistoryBatch(
          token,
          routes.map((route) => route.id)
        );
        if (cancelled) return;

        const candidates = routes.map((route) => ({
          routeId: route.id,
          routeName: route.name,
          attempts: historyByRoute[route.id] ?? [],
        }));

        const chosen = pickFeaturedRoute(candidates);
        const history = chosen ? shapeRouteHistory(chosen.attempts, sessionId) : null;

        setFeatured(
          chosen && history
            ? { routeId: chosen.routeId, routeName: chosen.routeName, history }
            : null
        );
      } catch {
        if (!cancelled) setFeatured(null);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getIdToken, routeKey, sessionId]);

  if (!featured) return null;

  return (
    <section className={className} aria-labelledby="session-route-history">
      <SectionHeading>
        <span id="session-route-history">Your history on this route</span>
      </SectionHeading>

      <p className="mt-1 text-sm text-muted">
        <Link
          href={`/routes/${featured.routeId}`}
          className="text-ink-2 hover:underline"
        >
          {featured.routeName || "This route"}
        </Link>
        {/* Strava-style participation, never a bare rank — each numeral
            (the ordinal, the total) gets its own mono span; "of your" and
            "attempts" stay plain words around them. */}
        {featured.history.currentRank != null ? (
          <>
            {" · "}
            <span className="font-mono-num tabular-nums">
              {ordinalLabel(featured.history.currentRank)}
            </span>
            {" of your "}
            <span className="font-mono-num tabular-nums">
              {featured.history.totalAttempts}
            </span>
            {" attempts"}
          </>
        ) : null}
      </p>

      <div className="mt-4 divide-y divide-hairline">
        {featured.history.entries.map((entry) => (
          <div
            key={entry.sessionId}
            className="flex items-center justify-between gap-4 py-2 text-sm"
          >
            <span className={entry.isCurrent ? "font-medium text-ink" : "text-ink-2"}>
              {formatShortDate(entry.startTime)}
              {entry.isCurrent ? " · this activity" : null}
            </span>
            <span className="flex items-center gap-2 font-mono-num tabular-nums text-ink-2">
              {formatDurationValue(entry.totalTime) ?? "—"}
              {entry.isBest ? <Badge>Best</Badge> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
