"use server";

// Data aggregators for the two SEO landing families (Task 18):
// /activities/[type] and /peaks/[state]. Each function is the one round
// trip a page needs — generateMetadata and the page body both call the
// cache()-wrapped version in cached-landing.ts, so a request only pays for
// it once (same pattern as cached-search.ts / cached-lists.ts).

import type { AreaIndexRow } from "./areas";
import { getTopAreasForState } from "./areas";
import { getList } from "./lists";
import {
  getActivityLandingCount,
  getStateCatalogFacts,
  getTopDestinationsForState,
  getTopHikingDestinations,
  getTopSummitDestinations,
  type PopularDestinationsResult,
} from "./search";
import { CURATED_CLASSIC_LISTS } from "../constants";
import {
  activityLandingConfig,
  buildStateEditorialParagraph,
  type ActivityLandingType,
} from "../landing-copy";
import { subdivisionName } from "../regions";

const TOP_DESTINATION_COUNT = 12;
const TOP_AREA_COUNT = 6;

export interface ActivityLandingClassicList {
  id: string;
  name: string;
  destination_count: number;
}

export interface ActivityLandingData {
  type: ActivityLandingType;
  /** Exact live count used by FAQ answers. Null for unsupported activity
   * types and when the page is rendered without its database read. */
  count: number | null;
  paragraph: string;
  /** Empty for skiing/trail-running — see landing-copy.ts's hasLiveContent. */
  top: PopularDestinationsResult;
  /** Only populated for peak-bagging, where the curated lists are actually
   * about summits. Empty elsewhere rather than repeating an unrelated list
   * on every activity page. */
  lists: ActivityLandingClassicList[];
}

/** hiking/peak-bagging: the live count + top-12 + (peak-bagging only) the
 * curated classic lists. skiing/trail-running: the static paragraph only —
 * no query exists to back a "top 12" or a list for either (see
 * landing-copy.ts's hasLiveContent). */
export async function getActivityLandingData(
  type: ActivityLandingType
): Promise<ActivityLandingData> {
  const config = activityLandingConfig(type);

  if (!config.hasLiveContent) {
    return {
      type,
      count: null,
      paragraph: config.paragraph({ count: null }),
      top: { destinations: [], isFallback: false },
      lists: [],
    };
  }

  const countType: "hiking" | "peak-bagging" = type === "peak-bagging" ? "peak-bagging" : "hiking";

  const [count, top, listRows] = await Promise.all([
    getActivityLandingCount(countType),
    type === "peak-bagging"
      ? getTopSummitDestinations(TOP_DESTINATION_COUNT)
      : getTopHikingDestinations(TOP_DESTINATION_COUNT),
    type === "peak-bagging"
      ? Promise.all(CURATED_CLASSIC_LISTS.map((entry) => getList(entry.id)))
      : Promise.resolve([]),
  ]);

  const lists: ActivityLandingClassicList[] = listRows
    .filter((list): list is NonNullable<typeof list> => list !== null)
    .map((list) => ({
      id: list.id,
      name: list.name,
      destination_count: list.destination_count,
    }));

  return {
    type,
    count,
    paragraph: config.paragraph({ count }),
    top,
    lists,
  };
}

export interface StateLandingData {
  stateCode: string;
  stateName: string;
  destinationCount: number;
  summitCount: number;
  highestPeak: { id: string; name: string; elevationFeet: number } | null;
  leadingArea: { name: string; destinationCount: number } | null;
  paragraph: string;
  top: PopularDestinationsResult;
  areas: AreaIndexRow[];
}

/** Null when the code isn't a known US state/territory, or when it is but
 * the catalog has nothing in it — both are the page's 404 signal. Runs the
 * cheap facts query first so an empty state never pays for the top-12 join
 * or the areas query. */
export async function getStateLandingData(stateCode: string): Promise<StateLandingData | null> {
  const stateName = subdivisionName("US", stateCode);
  if (!stateName) return null;

  const facts = await getStateCatalogFacts(stateCode);
  if (facts.destinationCount === 0) return null;

  const [top, areas] = await Promise.all([
    getTopDestinationsForState(stateCode, TOP_DESTINATION_COUNT),
    getTopAreasForState(stateCode, TOP_AREA_COUNT),
  ]);

  const highestPeak =
    facts.highestPeak?.name != null
      ? {
          id: facts.highestPeak.id,
          name: facts.highestPeak.name,
          elevationFeet: Math.round(facts.highestPeak.elevation * 3.28084),
        }
      : null;

  const leadingArea = areas[0]
    ? { name: areas[0].name, destinationCount: areas[0].destinationCount }
    : null;

  const paragraph = buildStateEditorialParagraph({
    stateName,
    destinationCount: facts.destinationCount,
    summitCount: facts.summitCount,
    highestPeak,
    leadingArea,
  });

  return {
    stateCode,
    stateName,
    destinationCount: facts.destinationCount,
    summitCount: facts.summitCount,
    highestPeak,
    leadingArea,
    paragraph,
    top,
    areas,
  };
}
