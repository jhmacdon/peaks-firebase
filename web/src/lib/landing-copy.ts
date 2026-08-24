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

/** Only these pages have live, distinct Peaks data. The other activity URLs
 * stay available as honest product notes, but they must not be presented to
 * crawlers as full catalog guides until the product can support them. */
export const INDEXABLE_ACTIVITY_LANDING_TYPES = [
  "hiking",
  "peak-bagging",
] as const satisfies readonly ActivityLandingType[];

export interface LandingFaq {
  question: string;
  answer: string;
}

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
  faqs: (facts: ActivityLandingFacts) => LandingFaq[];
}

const ACTIVITY_LANDING_CONFIG: Record<ActivityLandingType, ActivityLandingConfig> = {
  hiking: {
    title: "Hiking tracker and route planner for iPhone",
    h1: "An iPhone hiking tracker and route planner",
    label: "Hiking",
    hasLiveContent: true,
    paragraph: ({ count }) =>
      count && count > 0
        ? `Peaks is an iPhone hiking tracker and route planner. It records distance, gain, time, and the summits or trailheads reached along the way. ${formatFlooredCount(count, 100)} hikes are recorded so far — browse where people are going.`
        : "Peaks is an iPhone hiking tracker and route planner. It records distance, gain, time, and the summits or trailheads reached along the way.",
    faqs: ({ count }) => [
      {
        question: "Is Peaks a hiking tracker for iPhone?",
        answer:
          "Yes. Peaks records distance, elevation gain, time, GPS tracks, photos, and reached destinations on iPhone.",
      },
      {
        question: "What does Peaks track on a hike?",
        answer:
          "Peaks records distance, elevation gain, time, and the summits or trailheads reached on each hike.",
      },
      ...(count && count > 0
        ? [
            {
              question: "How many hikes are recorded in Peaks?",
              answer: `Peaks has ${count.toLocaleString("en-US")} recorded hikes. This catalog count is read from Peaks activity data and updates as people log new trips.`,
            },
          ]
        : []),
      {
        question: "Can I use Peaks to plan a hike?",
        answer:
          "Yes. Peaks links mountains, trailheads, protected areas, and published routes so you can check a place before you go.",
      },
    ],
  },
  "peak-bagging": {
    title: "Peak-bagging app for iPhone",
    h1: "A peak-bagging app for iPhone",
    label: "Peak-bagging",
    hasLiveContent: true,
    paragraph: ({ count }) =>
      count && count > 0
        ? `Peaks is an iPhone peak-bagging app and public mountain guide. The catalog holds ${formatFlooredCount(count, 1000)} named summits, from roadside high points to technical climbs. Track the ones you've reached, plan the ones you haven't, and see what other climbers are logging.`
        : "Peaks is an iPhone peak-bagging app and public mountain guide. Track the summits you've reached, plan the ones you haven't, and see what other climbers are logging.",
    faqs: ({ count }) => [
      {
        question: "What should I look for in a peak-bagging app?",
        answer:
          "A useful peak-bagging app should combine a summit catalog, route planning, GPS recording, list progress, and trip notes. Peaks brings those tools together on iPhone.",
      },
      ...(count && count > 0
        ? [
            {
              question: "How many summits are in Peaks?",
              answer: `Peaks has ${count.toLocaleString("en-US")} destinations tagged as summits. The count comes from the live Peaks catalog.`,
            },
          ]
        : []),
      {
        question: "Can I track a peak-bagging list in Peaks?",
        answer:
          "Yes. Peaks shows curated mountain lists and records which summits you have reached on each one.",
      },
      {
        question: "What is on a Peaks mountain page?",
        answer:
          "A mountain page can include elevation, a map, current weather, standard routes, nearby trailheads, protected areas, and trip reports.",
      },
    ],
  },
  skiing: {
    title: "Skiing",
    h1: "Skiing with Peaks",
    label: "Skiing",
    hasLiveContent: false,
    paragraph: () =>
      "Peaks doesn't track ski touring as its own activity yet — a trip on skis logs the same way a trip on foot does. There's no separate ski catalog to browse yet, but the trailheads and summits below are the same ones skiers use.",
    faqs: () => [],
  },
  "trail-running": {
    title: "Trail running",
    h1: "Trail running with Peaks",
    label: "Trail running",
    hasLiveContent: false,
    paragraph: () =>
      "Peaks logs a run the same way it logs a hike: one trek, with distance and gain, no separate tag for pace. Until that split exists, the hiking catalog is the fastest way to find good trail.",
    faqs: () => [],
  },
};

export function activityLandingConfig(type: ActivityLandingType): ActivityLandingConfig {
  return ACTIVITY_LANDING_CONFIG[type];
}

// ── /peaks/[state] ──────────────────────────────────────────────────────

/** US state landing pages with enough catalog depth to publish in search.
 * A live catalog check on 2026-08-20 found that every state except Delaware
 * and Rhode Island cleared the 50-destination bar. Keeping this reviewed
 * roster in code keeps the landing sitemap independent from a database count
 * during an outage. Recheck it when either omitted state
 * gains enough catalog data. */
export const INDEXABLE_US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

export interface StateLandingFacts {
  stateName: string;
  /** Total catalog destinations in the state — always > 0 by the time this
   * runs; the page 404s first (see landing.ts) when a state has none. */
  destinationCount: number;
  /** Destinations tagged as summits, kept separate from the wider catalog
   * count so a trailhead or lake is never described as a peak. */
  summitCount: number;
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
  const {
    stateName,
    destinationCount,
    summitCount,
    highestPeak,
    leadingArea,
  } = facts;

  const countPhrase = `${destinationCount.toLocaleString("en-US")} destination${destinationCount === 1 ? "" : "s"}`;
  const summitPhrase = `${summitCount.toLocaleString("en-US")} named summit${summitCount === 1 ? "" : "s"}`;
  let copy = `Peaks tracks ${countPhrase} in ${stateName}${
    summitCount > 0 ? `, including ${summitPhrase}` : ""
  }.`;

  if (highestPeak) {
    copy += ` The highest cataloged summit is ${highestPeak.name} at ${highestPeak.elevationFeet.toLocaleString("en-US")} ft.`;
  }

  if (leadingArea) {
    copy += ` ${leadingArea.destinationCount.toLocaleString("en-US")} of the state's destinations are in ${leadingArea.name}, more than in any other protected area in the catalog.`;
  }

  return copy;
}

export function buildStateLandingFaqs(facts: StateLandingFacts): LandingFaq[] {
  const {
    stateName,
    destinationCount,
    summitCount,
    highestPeak,
    leadingArea,
  } = facts;

  return [
    {
      question: `Can I track peak-bagging progress in ${stateName} with Peaks?`,
      answer: `Yes. The Peaks iPhone app records reached summits, distance, elevation gain, time, photos, and trip notes. The ${stateName} guide helps you choose what to climb next.`,
    },
    {
      question: `How many peaks are in the Peaks catalog for ${stateName}?`,
      answer: `Peaks lists ${summitCount.toLocaleString("en-US")} destination${summitCount === 1 ? "" : "s"} tagged as ${summitCount === 1 ? "a summit" : "summits"} in ${stateName}. The full state catalog has ${destinationCount.toLocaleString("en-US")} mountain destinations, including trailheads, lakes, and viewpoints.`,
    },
    ...(highestPeak
      ? [
          {
            question: `What is the highest peak in ${stateName}?`,
            answer: `${highestPeak.name} is the highest summit in the Peaks catalog for ${stateName} at ${highestPeak.elevationFeet.toLocaleString("en-US")} ft.`,
          },
        ]
      : []),
    ...(leadingArea
      ? [
          {
            question: `Which protected area in ${stateName} has the most cataloged destinations?`,
            answer: `${leadingArea.name} has ${leadingArea.destinationCount.toLocaleString("en-US")} linked destinations, the most of any protected area in the Peaks catalog for ${stateName}.`,
          },
        ]
      : []),
  ];
}
