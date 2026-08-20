// Pure helpers for "efforts-lite" route history: the session page's "Your
// history on this route" section and the route page's one-line summary.
// Free of React and DB calls so attempt ordering, best-selection and the
// participation phrasing are unit-tested (route-history.test.ts) rather than
// re-derived inside a component.
//
// Framed Strava-style — "3rd of your 5 attempts" — never a bare rank
// (web/docs/audits/2026-08-19-strava-signed-in.md §6: "Rank is always a
// fraction, never a bare number"). Every query behind this only ever reads
// the requesting user's own session_routes rows — there is no cross-user
// comparison here, so there is nothing to rank against.

import { formatDurationValue } from "./session-detail";

/** One of the user's own sessions matched to a route (`session_routes`). */
export interface RouteAttempt {
  sessionId: string;
  /** ISO 8601. */
  startTime: string;
  /** Seconds; null when the session never recorded one. */
  totalTime: number | null;
}

export interface RouteHistoryEntry extends RouteAttempt {
  isCurrent: boolean;
  isBest: boolean;
}

export interface RouteHistorySummary {
  totalAttempts: number;
  /** Fastest recorded moving time among the attempts, or null when none of
   * them recorded one. */
  bestSeconds: number | null;
  /** 1-based chronological position of the current session among all
   * attempts, or null when the current session isn't one of them. */
  currentRank: number | null;
  /** Newest attempt first, for the compact list. */
  entries: RouteHistoryEntry[];
}

function safeTime(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "1st" / "2nd" / "3rd" / "4th" / "11th" / "21st". */
export function ordinalLabel(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Fastest recorded moving time, ignoring attempts with none. Null when no
 * attempt recorded a time at all. */
export function bestSecondsFromAttempts(attempts: RouteAttempt[]): number | null {
  let best: number | null = null;
  for (const attempt of attempts) {
    if (attempt.totalTime == null) continue;
    if (best == null || attempt.totalTime < best) best = attempt.totalTime;
  }
  return best;
}

/** The most recent attempt by start time, or null for an empty list. */
export function latestAttempt(attempts: RouteAttempt[]): RouteAttempt | null {
  if (attempts.length === 0) return null;
  return attempts.reduce((latest, attempt) =>
    safeTime(attempt.startTime) > safeTime(latest.startTime) ? attempt : latest
  );
}

/** The session detail section's data: count, best, and the compact list —
 * newest first, current session and fastest time marked. `currentRank` +
 * `totalAttempts` are the participation phrase's raw numerals ("3rd of your
 * 5 attempts"); composed by the caller rather than pre-baked into a string
 * here so each numeral can get its own `font-mono-num` span (design-tokens.md:
 * every stat value is Geist Mono) while the words around them stay plain
 * text — see `ordinalLabel` below. Null when there's nothing worth showing:
 * a route the current session is the *only* attempt on has no history to
 * compare against (requirement: "section absent when no matched route or
 * only one attempt"). */
export function shapeRouteHistory(
  attempts: RouteAttempt[],
  currentSessionId: string
): RouteHistorySummary | null {
  if (attempts.length < 2) return null;

  const chronological = [...attempts].sort(
    (a, b) => safeTime(a.startTime) - safeTime(b.startTime)
  );

  const bestSeconds = bestSecondsFromAttempts(chronological);
  const bestSessionId =
    bestSeconds == null
      ? null
      : chronological.find((attempt) => attempt.totalTime === bestSeconds)?.sessionId ?? null;

  const currentIndex = chronological.findIndex(
    (attempt) => attempt.sessionId === currentSessionId
  );
  const currentRank = currentIndex === -1 ? null : currentIndex + 1;

  const entries: RouteHistoryEntry[] = [...chronological]
    .reverse()
    .map((attempt) => ({
      ...attempt,
      isCurrent: attempt.sessionId === currentSessionId,
      isBest: bestSessionId != null && attempt.sessionId === bestSessionId,
    }));

  return {
    totalAttempts: chronological.length,
    bestSeconds,
    currentRank,
    entries,
  };
}

/** A route the session matched, with the user's full attempt history on it
 * (session_routes joined back to tracking_sessions for this user). */
export interface RouteMatchCandidate {
  routeId: string;
  routeName: string | null;
  attempts: RouteAttempt[];
}

/** A session can match several catalog routes at once (overlapping trail
 * segments, a route and a nearby variant). Rather than fabricate a "primary"
 * route or print one history block per match, this features the single
 * route with the richest attempt history — ties broken by name — and the
 * rest stay in the existing "On this activity" route chips. Routes with
 * fewer than two attempts (nothing to compare) aren't eligible. */
export function pickFeaturedRoute(
  candidates: RouteMatchCandidate[]
): RouteMatchCandidate | null {
  const eligible = candidates.filter((candidate) => candidate.attempts.length >= 2);
  if (eligible.length === 0) return null;

  return eligible.reduce((best, candidate) => {
    if (candidate.attempts.length !== best.attempts.length) {
      return candidate.attempts.length > best.attempts.length ? candidate : best;
    }
    const bestName = (best.routeName ?? "").toLowerCase();
    const candidateName = (candidate.routeName ?? "").toLowerCase();
    return candidateName < bestName ? candidate : best;
  });
}

/** The route page's one-liner — "You've done this route 4 times · Best:
 * 4h 12m" — as parts rather than one pre-baked string, so the component can
 * wrap just the numerals (`count`, `bestLabel`) in their own `font-mono-num`
 * span and leave the surrounding words as plain text (design-tokens.md:
 * every stat value is Geist Mono). Null when the user has never done the
 * route (requirement: "Absent when zero"). */
export interface RouteHistoryHeadlineParts {
  count: number;
  timesWord: "time" | "times";
  /** "4h 12m", or null when nothing recorded a time — the "· Best: …" clause
   * is dropped entirely rather than printed with a dash. */
  bestLabel: string | null;
}

export function buildRouteHistoryHeadlineParts(
  totalAttempts: number,
  bestSeconds: number | null
): RouteHistoryHeadlineParts | null {
  if (totalAttempts <= 0) return null;
  return {
    count: totalAttempts,
    timesWord: totalAttempts === 1 ? "time" : "times",
    bestLabel: formatDurationValue(bestSeconds),
  };
}
