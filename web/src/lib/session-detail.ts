// Pure helpers for the activity detail page (`/log/[id]`) and the session
// log. Free of React, DB and Firestore calls so the number rules, the
// never-null filtering and the "reached at" derivation are unit-tested
// (src/lib/session-detail.test.ts) instead of being re-invented inside a
// component.

// formatFeetValue/formatMilesValue are the same bare-numeral formatters the
// destination, route and area toplines print — one rounding rule for the
// whole site, not a second copy for activities.
import { formatFeetValue, formatMilesValue } from "./destination-detail";
import { distanceBetweenSessionPoints } from "./session-track";

const METERS_PER_MILE = 1609.34;

/** One entry of a StatCluster row: bare numeral, unit as its own smaller
 * span, sentence-case label (design-tokens.md, "StatCluster scale"). */
export interface SessionStat {
  key: string;
  value: string;
  unit?: string;
  label: string;
}

/** The subset of `SessionDetail` the stat builders read. Structural rather
 * than the full row so the helpers stay testable without a DB shape. */
export interface SessionStatSource {
  distance: number | null;
  gain: number | null;
  total_time: number | null;
  highest_point: number | null;
  pace: number | null;
  ascent_time: number | null;
  descent_time: number | null;
  start_time: string;
  end_time: string | null;
}

/** Heart-rate/energy figures, already summarized by lib/session-health.ts. */
export interface SessionHealthStats {
  averageHeartRate: number | null;
  maximumHeartRate: number | null;
  activeCalories: number | null;
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** "4h 8m" / "48m" — a recorded duration, never an estimate, so no
 * quarter-hour rounding. Null when there is nothing to print. */
export function formatDurationValue(
  seconds: number | null | undefined
): string | null {
  if (!finite(seconds) || seconds < 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "26:23" — minutes:seconds per mile from a speed in metres per second.
 * Null below 0.05 m/s: under that the reading is a paused recording, not a
 * pace, and would print an eight-hour mile. */
export function formatPaceValue(
  metersPerSecond: number | null | undefined
): string | null {
  if (!finite(metersPerSecond) || metersPerSecond < 0.05) return null;
  const secondsPerMile = Math.round(METERS_PER_MILE / metersPerSecond);
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = secondsPerMile % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** "1:04:22" / "4:22" — a clock reading for the playback scrubber. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  const paddedSeconds = remainder.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/** Seconds between the recorded start and end of an activity. Null when the
 * activity never ended, or when the clock runs backwards. */
export function elapsedSeconds(
  startTime: string,
  endTime: string | null
): number | null {
  if (!endTime) return null;
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = (end - start) / 1000;
  return seconds > 0 ? seconds : null;
}

/** The four topline numerals: distance, gain, time, high point. Anything
 * the recording didn't capture is dropped rather than printed as a dash. */
export function buildSessionTopline(session: SessionStatSource): SessionStat[] {
  const distance = formatMilesValue(session.distance);
  const gain = formatFeetValue(session.gain);
  const time = formatDurationValue(session.total_time);
  const highPoint = formatFeetValue(session.highest_point);

  return [
    distance ? { key: "distance", value: distance, unit: "mi", label: "Distance" } : null,
    gain ? { key: "gain", value: gain, unit: "ft", label: "Elevation gain" } : null,
    time ? { key: "time", value: time, label: "Time" } : null,
    highPoint ? { key: "high", value: highPoint, unit: "ft", label: "High point" } : null,
  ].filter((stat): stat is SessionStat => stat !== null);
}

/** Ascent and descent times are written by the recorder and, on a handful of
 * older imports, disagree wildly with the activity's own length — one 28-hour
 * session in production claims 35 hours of climbing. Print the pair only when
 * it fits inside the recorded time (2% slack for rounding), so a broken row
 * shows nothing instead of an impossible number. */
export function ascentDescentFits(session: SessionStatSource): boolean {
  if (!finite(session.ascent_time) || !finite(session.descent_time)) return false;
  if (!finite(session.total_time) || session.total_time <= 0) return false;
  if (session.ascent_time < 0 || session.descent_time < 0) return false;
  return session.ascent_time + session.descent_time <= session.total_time * 1.02;
}

/** The smaller grid under the topline: pace, the elapsed/recorded contrast,
 * time spent climbing and descending, and whatever health samples came with
 * the activity. Absent fields are omitted, never dashed. */
export function buildSessionSecondaryStats(
  session: SessionStatSource,
  health: SessionHealthStats | null
): SessionStat[] {
  const stats: SessionStat[] = [];

  const pace = formatPaceValue(session.pace);
  if (pace) stats.push({ key: "pace", value: pace, unit: "/mi", label: "Pace" });

  // Only worth its own cell when the wall clock and the recorded time
  // actually disagree — a minute of slack covers rounding at the boundary.
  const elapsed = elapsedSeconds(session.start_time, session.end_time);
  if (
    elapsed != null &&
    (!finite(session.total_time) || Math.abs(elapsed - session.total_time) >= 60)
  ) {
    const value = formatDurationValue(elapsed);
    if (value) stats.push({ key: "elapsed", value, label: "Elapsed" });
  }

  if (ascentDescentFits(session)) {
    const climbing = formatDurationValue(session.ascent_time);
    const descending = formatDurationValue(session.descent_time);
    if (climbing) stats.push({ key: "ascent", value: climbing, label: "Time climbing" });
    if (descending) {
      stats.push({ key: "descent", value: descending, label: "Time descending" });
    }
  }

  if (health) {
    if (finite(health.averageHeartRate)) {
      stats.push({
        key: "avg-hr",
        value: Math.round(health.averageHeartRate).toLocaleString("en-US"),
        unit: "bpm",
        label: "Avg heart rate",
      });
    }
    if (finite(health.maximumHeartRate)) {
      stats.push({
        key: "max-hr",
        value: Math.round(health.maximumHeartRate).toLocaleString("en-US"),
        unit: "bpm",
        label: "Max heart rate",
      });
    }
    if (finite(health.activeCalories)) {
      stats.push({
        key: "energy",
        value: Math.round(health.activeCalories).toLocaleString("en-US"),
        unit: "cal",
        label: "Active energy",
      });
    }
  }

  return stats;
}

export interface SessionSplit {
  /** 1-based; the last entry may cover less than a full mile. */
  mile: number;
  /** How much of a mile this split covers — 1 for every split but the last. */
  fraction: number;
  /** Seconds spent covering it. */
  seconds: number;
  /** Seconds per mile, so a short final split is comparable with the rest. */
  secondsPerMile: number;
  /** Net elevation change in metres; null when the track carries no
   * elevation across the split. */
  changeMeters: number | null;
}

/** Per-mile splits, derived from the track. `session_splits` is not a table:
 * the recorder stores points, and the mile boundaries fall between them, so
 * each boundary's time and elevation are interpolated from the two points
 * that bracket it.
 *
 * `distances` is the cumulative-distance array from
 * buildSessionDistances(points) — it does not advance across a pause, which
 * is what keeps a resumed recording from inventing a mile of travel between
 * segments. */
export function buildSessionSplits(
  points: { time: number; elevation: number | null }[],
  distances: number[]
): SessionSplit[] {
  if (points.length < 2 || distances.length !== points.length) return [];
  const total = distances[distances.length - 1];
  if (!Number.isFinite(total) || total < METERS_PER_MILE * 0.1) return [];

  type Mark = { dist: number; time: number; elevation: number | null };
  const marks: Mark[] = [
    { dist: 0, time: points[0].time, elevation: points[0].elevation },
  ];

  let boundary = METERS_PER_MILE;
  for (let index = 1; index < points.length; index += 1) {
    while (boundary <= distances[index] && boundary <= total) {
      const span = distances[index] - distances[index - 1];
      const ratio = span > 0 ? (boundary - distances[index - 1]) / span : 0;
      const from = points[index - 1];
      const to = points[index];
      marks.push({
        dist: boundary,
        time: from.time + ratio * (to.time - from.time),
        elevation:
          from.elevation != null && to.elevation != null
            ? from.elevation + ratio * (to.elevation - from.elevation)
            : null,
      });
      boundary += METERS_PER_MILE;
    }
  }

  // A trailing sliver isn't a split — under a twentieth of a mile it is a
  // rounding artefact of where the recorder stopped.
  const lastMark = marks[marks.length - 1];
  if (total - lastMark.dist > METERS_PER_MILE * 0.05) {
    const final = points[points.length - 1];
    marks.push({ dist: total, time: final.time, elevation: final.elevation });
  }

  const splits: SessionSplit[] = [];
  for (let index = 1; index < marks.length; index += 1) {
    const from = marks[index - 1];
    const to = marks[index];
    const fraction = (to.dist - from.dist) / METERS_PER_MILE;
    const seconds = Math.max(0, to.time - from.time);
    splits.push({
      mile: index,
      fraction,
      seconds,
      secondsPerMile: fraction > 0 ? seconds / fraction : 0,
      changeMeters:
        from.elevation != null && to.elevation != null
          ? to.elevation - from.elevation
          : null,
    });
  }
  return splits;
}

/** How wide a smoothing window a series of this length gets. Raw per-point
 * GPS speed swings by several mph between consecutive samples, which draws a
 * picket fence rather than a line and hides the elevation context behind it.
 * The window scales with the recording so a 20-minute walk isn't flattened
 * by the same span that tames a nine-hour climb, and it is capped so a very
 * long track keeps its shape. */
export function smoothingRadius(sampleCount: number): number {
  if (sampleCount < 12) return 0;
  return Math.min(12, Math.max(2, Math.round(sampleCount / 120)));
}

/** Centred moving average over the non-null samples inside the window.
 * Nulls stay null — a gap in the recording is not something to average
 * across — and the ends taper naturally by averaging fewer neighbours. */
export function smoothMetricSeries(
  values: (number | null)[]
): (number | null)[] {
  const radius = smoothingRadius(values.length);
  if (radius === 0) return values;

  return values.map((value, index) => {
    if (value == null || !Number.isFinite(value)) return null;
    let total = 0;
    let count = 0;
    const from = Math.max(0, index - radius);
    const to = Math.min(values.length - 1, index + radius);
    for (let i = from; i <= to; i += 1) {
      const neighbour = values[i];
      if (neighbour == null || !Number.isFinite(neighbour)) continue;
      total += neighbour;
      count += 1;
    }
    return count > 0 ? total / count : value;
  });
}

export interface ReachedDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
  relation: string;
}

export interface SessionAchievement {
  id: string;
  name: string;
  elevation: number | null;
  /** Epoch seconds of the nearest recorded track point, or null when no
   * point came close enough to claim a time. */
  reachedAt: number | null;
}

/** How close a recorded point has to pass before its timestamp is offered as
 * the moment a destination was reached. Tracks are downsampled to 2,000
 * points on the way out of the database, so on a long trip consecutive points
 * can sit a few hundred metres apart — 500 m keeps a genuine summit visit
 * inside the gate without letting a track that merely passed through the
 * valley claim one. */
const REACHED_RADIUS_METERS = 500;

/** One line per destination reached: "Reached Camp Muir · 10:42 AM". The
 * timestamp is derived, not stored — session_destinations records *that* a
 * destination was reached, never when — so it comes from the nearest
 * recorded track point, and is dropped when nothing passed close enough. */
export function buildSessionAchievements(
  destinations: ReachedDestination[],
  points: { lat: number; lng: number; time: number }[]
): SessionAchievement[] {
  const reached = destinations.filter(
    (destination) => destination.relation === "reached" && destination.name
  );

  const achievements = reached.map((destination) => {
    let closestDistance = Infinity;
    let closestTime: number | null = null;

    for (const point of points) {
      const distance = distanceBetweenSessionPoints(point, destination);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestTime = point.time;
      }
    }

    return {
      id: destination.id,
      name: destination.name as string,
      elevation: destination.elevation,
      reachedAt:
        closestDistance <= REACHED_RADIUS_METERS && closestTime != null
          ? closestTime
          : null,
    };
  });

  // Chronological where the track allows it — the order a reader walked
  // them. Anything without a time falls to the end, highest first, which is
  // the same order the activity's own name uses.
  return achievements.sort((left, right) => {
    if (left.reachedAt != null && right.reachedAt != null) {
      return left.reachedAt - right.reachedAt;
    }
    if (left.reachedAt != null) return -1;
    if (right.reachedAt != null) return 1;
    return (right.elevation ?? 0) - (left.elevation ?? 0);
  });
}
