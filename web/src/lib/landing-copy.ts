// Pure copy builders for the two SEO landing families (Task 18):
// /activities/[type] and /peaks/[state]. Kept free of DB calls, same reason
// as seo-descriptions.ts — the sentences are unit-testable and every
// generateMetadata/page pair reads the same rules instead of inventing its
// own rounding or omission logic.

import { formatFlooredCount } from "./format";

// ── /activities/[type] ──────────────────────────────────────────────────

export const ACTIVITY_LANDING_TYPES = [
  "hiking",
  "peak-bagging",
  "skiing",
  "trail-running",
] as const;

export type ActivityLandingType = (typeof ACTIVITY_LANDING_TYPES)[number];

export function isActivityLandingType(value: string): value is ActivityLandingType {
  return (ACTIVITY_LANDING_TYPES as readonly string[]).includes(value);
}

export interface ActivityLandingFacts {
  /** A live count backing the paragraph — recorded hikes for hiking, named
   * summits for peak-bagging. Null when the read failed or the type has no
   * such count (skiing, trail-running): the paragraph drops the number
   * rather than print a stale or invented one. */
  count: number | null;
}

interface ActivityLandingConfig {
  /** <title>, before the root layout's " | Peaks" template. */
  title: string;
  /** The on-page display H1. */
  h1: string;
  /** Section-heading eyebrow above the top-12 grid and, for skiing/
   * trail-running, the label the honesty note refers back to. */
  label: string;
  /** Real, catalog-backed query exists for this type (hiking, peak-bagging)
   * — false for skiing and trail-running, where nothing in the schema
   * distinguishes the activity from a plain trek (see landing.ts). A false
   * page renders fewer modules instead of relabeling someone else's data. */
  hasLiveContent: boolean;
  paragraph: (facts: ActivityLandingFacts) => string;
}

const ACTIVITY_LANDING_CONFIG: Record<ActivityLandingType, ActivityLandingConfig> = {
  hiking: {
    title: "Hiking",
    h1: "Hiking with Peaks",
    label: "Hiking",
    hasLiveContent: true,
    paragraph: ({ count }) =>
      count && count > 0
        ? `Peaks logs every hike as a trek: distance, gain, and the summits or trailheads reached along the way. ${formatFlooredCount(count, 100)} hikes are recorded so far — browse where people are going.`
        : "Peaks logs every hike as a trek: distance, gain, and the summits or trailheads reached along the way.",
  },
  "peak-bagging": {
    title: "Peak-bagging",
    h1: "Peak-bagging with Peaks",
    label: "Peak-bagging",
    hasLiveContent: true,
    paragraph: ({ count }) =>
      count && count > 0
        ? `The catalog holds ${formatFlooredCount(count, 1000)} named summits, from roadside high points to technical climbs. Track the ones you've reached, plan the ones you haven't, and see what other climbers are logging.`
        : "Track the summits you've reached, plan the ones you haven't, and see what other climbers are logging.",
  },
  skiing: {
    title: "Skiing",
    h1: "Skiing with Peaks",
    label: "Skiing",
    hasLiveContent: false,
    paragraph: () =>
      "Peaks doesn't track ski touring as its own activity yet — a trip on skis logs the same way a trip on foot does. There's no separate ski catalog to browse yet, but the trailheads and summits below are the same ones skiers use.",
  },
  "trail-running": {
    title: "Trail running",
    h1: "Trail running with Peaks",
    label: "Trail running",
    hasLiveContent: false,
    paragraph: () =>
      "Peaks logs a run the same way it logs a hike: one trek, with distance and gain, no separate tag for pace. Until that split exists, the hiking catalog is the fastest way to find good trail.",
  },
};

export function activityLandingConfig(type: ActivityLandingType): ActivityLandingConfig {
  return ACTIVITY_LANDING_CONFIG[type];
}

// ── /peaks/[state] ──────────────────────────────────────────────────────

export interface StateLandingFacts {
  stateName: string;
  /** Total catalog destinations in the state — always > 0 by the time this
   * runs; the page 404s first (see landing.ts) when a state has none. */
  destinationCount: number;
  highestPeak: { name: string; elevationFeet: number } | null;
  /** The protected area with the most linked destinations in the state, and
   * how many of the state's destinations sit in it — a specific, checkable
   * fact rather than an eyeballed "much of it" claim. */
  leadingArea: { name: string; destinationCount: number } | null;
}

/** One computed paragraph per state: count, highest peak, one notable area.
 * Every clause is conditional on the fact existing — a state with an
 * unresolved highest peak or no linked areas just gets a shorter, still
 * true, sentence rather than a dash or a placeholder. */
export function buildStateEditorialParagraph(facts: StateLandingFacts): string {
  const { stateName, destinationCount, highestPeak, leadingArea } = facts;

  const countPhrase = `${destinationCount.toLocaleString("en-US")} destination${destinationCount === 1 ? "" : "s"}`;
  let sentence = `Peaks tracks ${countPhrase} in ${stateName}`;

  if (highestPeak) {
    sentence += `, topping out at ${highestPeak.name} (${highestPeak.elevationFeet.toLocaleString("en-US")} ft)`;
  }
  sentence += ".";

  if (leadingArea) {
    sentence += ` ${leadingArea.destinationCount.toLocaleString("en-US")} of those are in ${leadingArea.name}, the state's best-represented protected area.`;
  }

  return sentence;
}
