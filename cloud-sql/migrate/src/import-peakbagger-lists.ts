/**
 * Imports a small, reviewed set of Peakbagger lists from saved audit JSON.
 *
 * Dry-run is the default. The input is the browser audit export keyed by
 * Peakbagger list ID, with each value containing a `rows` array.
 *
 * The saved rows live in the repo, not in /tmp.
 *
 * Examples:
 *   npm run import:peakbagger-lists -- \
 *     --input=../../docs/data-audits/fixtures/peakbagger-list-candidates-2026-08-21.json
 *   npm run import:peakbagger-lists -- \
 *     --input=../../docs/data-audits/fixtures/peakbagger-list-candidates-2026-08-21.json --apply
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { PoolClient } from "pg";
import db from "./db";
import { normalizeStoredListCompletionTarget } from "./list-completion-target";

export interface ImportArgs {
  input: string;
  apply: boolean;
}

export interface PeakbaggerSourcePeak {
  ordinal: number;
  peakbaggerPeakId: number;
  name: string;
  elevationFt: number;
  lat?: number;
  lng?: number;
}

interface PeakbaggerSourceList {
  rows: PeakbaggerSourcePeak[];
}

type PeakbaggerAudit = Record<string, PeakbaggerSourceList>;

export interface CatalogPeak {
  id: string;
  name: string;
  elevationM: number | null;
  lat: number;
  lng: number;
  osmId: string | null;
  countryCode?: string | null;
  stateCode?: string | null;
}

interface CuratedDestination {
  id: string;
  name: string;
  elevationM: number;
  lat: number;
  lng: number;
  countryCode: string;
  stateCode: string;
  osmId: string;
}

export interface CuratedList {
  listId: string;
  sourceListId: number;
  name: string;
  description: string;
  expectedCount: number;
  /** NULL/omitted means every roster member is required. */
  completionTarget?: number | null;
  /**
   * A list that takes only part of one Peakbagger page names the peaks it
   * takes. Set it with `sourceRowCount`, never alone: the selection says which
   * rows belong to the list, and the row count says the page they came from is
   * still the page that was reviewed. The Idaho 12ers and the fourteen ranked
   * 8,000ers both take a reviewed subset of a broader page.
   */
  sourcePeakIds?: number[];
  /** The row count the whole source page must still have before an adjustment. */
  sourceRowCount?: number;
  /** Reviewed keeper peaks that a source page folds into a paired entry. */
  supplementalSourcePeaks?: PeakbaggerSourcePeak[];
  destinationOverrides: Record<number, string>;
  /** ISO bounds for saved source rows that do not carry coordinates. */
  allowedCountryCodes?: string[];
  allowedStateCodes?: string[];
  yearEstablished: number | null;
  /** Nullable by design: plain elevation/prominence cuts have no keeper. */
  organization: string | null;
  sourceName: string;
  sourceUrl: string;
  region: string;
}

export interface ListUpsertParams {
  listId: string;
  name: string;
  description: string;
  completionTarget: number | null;
  yearEstablished: number | null;
  organization: string | null;
  sourceName: string;
  sourceUrl: string;
  region: string;
}

export function buildListUpsertParams(list: CuratedList): ListUpsertParams {
  const completionTarget = normalizeStoredListCompletionTarget(
    list.completionTarget,
    list.expectedCount
  );
  if (list.completionTarget != null && completionTarget == null) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} completion target must be between 1 and ` +
      `${list.expectedCount}`
    );
  }
  return {
    listId: list.listId,
    name: list.name,
    description: list.description,
    completionTarget,
    yearEstablished: list.yearEstablished,
    organization: list.organization,
    sourceName: list.sourceName,
    sourceUrl: list.sourceUrl,
    region: list.region,
  };
}

export interface ResolvedListMember {
  destinationId: string;
  ordinal: number;
  sourcePeakId: number;
  sourceName: string;
}

interface CurrentListMember {
  listId: string;
  destinationId: string;
  ordinal: number;
}

interface ListImportPlan {
  list: CuratedList;
  members: ResolvedListMember[];
  addedDestinationIds: string[];
  removedDestinationIds: string[];
  reorderedDestinationIds: string[];
}

export interface DestinationPeakbaggerId {
  destinationId: string;
  peakbaggerId: string;
}

const METERS_PER_FOOT = 0.3048;
const MAX_ELEVATION_DELTA_M = 100;
const MAX_SPATIAL_TIEBREAK_M = 5_000;

export function deterministicListId(sourceListId: number): string {
  return crypto
    .createHash("sha256")
    .update(`peakbagger:list:${sourceListId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

export function deterministicOsmDestinationId(osmId: string): string {
  return crypto
    .createHash("sha256")
    .update(`osm:node:${osmId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

const HIGH_ROCK_OSM_ID = "356773747";
const HIGH_ROCK_ID = deterministicOsmDestinationId(HIGH_ROCK_OSM_ID);
const CRESTONE_PEAK_ID = "eBNZkjZzZV96xo5f36bx";

// A list row can stand in for a catalog destination without being the same
// physical summit. Keep the list membership, but link the destination to its
// own exact Peakbagger page.
export const DESTINATION_PEAKBAGGER_ID_OVERRIDES: Record<string, string> = {
  [CRESTONE_PEAK_ID]: "5908",
};

// Added by cloud-sql/migrations/20260821_held_list_summits.sql, which is a
// data-only migration rather than a CURATED_DESTINATIONS entry. Named here so
// the overrides below read as peaks instead of hashes.
const NORTH_TWIN_MOUNTAIN_ID = deterministicOsmDestinationId("357730481");
const BONDCLIFF_ID = deterministicOsmDestinationId("357730899");
const EAST_OSCEOLA_ID = deterministicOsmDestinationId("357729942");

// Added by cloud-sql/migrations/20260821_or_co_list_summits.sql. Each is a peak
// the source list labels differently, so the override is what reaches it.
const KIGER_MANN_PEAK_ID = deterministicOsmDestinationId("6601323053");
const WEST_ANEROID_PEAK_ID = deterministicOsmDestinationId("9104370897");
const SNOWFIELD_PEAK_ID = deterministicOsmDestinationId("10074433560");
const MOCCASIN_LAKE_MOUNTAIN_ID = deterministicOsmDestinationId("9104420504");
const MARK_MOUNTAIN_ID = deterministicOsmDestinationId("13926474089");

// Added by cloud-sql/migrations/20260821_northeast_list_summits.sql. Only the
// two the source lists label differently need naming here.
const SOUTH_WEEKS_MOUNTAIN_ID = deterministicOsmDestinationId("3300692064");
const SOUTH_HORN_ID = deterministicOsmDestinationId("358225015");

// Added by cloud-sql/migrations/20260821_western_list_summits.sql. Only the
// eight that OpenStreetMap labels differently from the source list need naming.
const GRANITE_PEAK_ID = deterministicOsmDestinationId("358795039");
const SUPERSTITION_PEAK_ID = deterministicOsmDestinationId("359285748");
const INDIAN_HEAD_PEAK_ID = deterministicOsmDestinationId("358808164");
const OROCOPIA_MOUNTAIN_ID = deterministicOsmDestinationId("7556631806");
const SILVER_PEAK_SIERRA_ID = deterministicOsmDestinationId("358799671");
const WADE_PEAK_ID = deterministicOsmDestinationId("7515963927");
const HALLBACK_ID = deterministicOsmDestinationId("357805389");
const PLOTT_BALSAM_ID = deterministicOsmDestinationId("357803267");

export const CURATED_DESTINATIONS: CuratedDestination[] = [
  {
    id: HIGH_ROCK_ID,
    name: "High Rock",
    elevationM: 1359,
    lat: 35.9643538,
    lng: -82.5778551,
    countryCode: "US",
    stateCode: "TN",
    osmId: HIGH_ROCK_OSM_ID,
  },
  // Identity, height, and location evidence for these list-only summits lives in
  // docs/data-audits/fixtures/four-list-identity-resolutions-2026-08-30.json.
  {
    id: deterministicOsmDestinationId("2151026961"),
    name: "L'Isolée",
    elevationM: 4114,
    lat: 45.8545834,
    lng: 6.8909713,
    countryCode: "FR",
    stateCode: "ARA",
    osmId: "2151026961",
  },
  {
    id: deterministicOsmDestinationId("2151026984"),
    name: "Pointe Médiane",
    elevationM: 4097,
    lat: 45.854535,
    lng: 6.8920627,
    countryCode: "FR",
    stateCode: "ARA",
    osmId: "2151026984",
  },
  {
    id: deterministicOsmDestinationId("2151026980"),
    name: "Pointe Carmen",
    elevationM: 4109,
    lat: 45.8545513,
    lng: 6.8917806,
    countryCode: "FR",
    stateCode: "ARA",
    osmId: "2151026980",
  },
  {
    id: deterministicOsmDestinationId("2151026982"),
    name: "Pointe Chaubert",
    elevationM: 4074,
    lat: 45.8544068,
    lng: 6.8930535,
    countryCode: "FR",
    stateCode: "ARA",
    osmId: "2151026982",
  },
  {
    id: deterministicOsmDestinationId("2965253469"),
    name: "Beinn a' Bhuird",
    elevationM: 1197,
    lat: 57.0876067,
    lng: -3.4994129,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "2965253469",
  },
  {
    id: deterministicOsmDestinationId("255419413"),
    name: "Aonach Beag",
    elevationM: 1116,
    lat: 56.8334981,
    lng: -4.529208,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "255419413",
  },
  {
    id: deterministicOsmDestinationId("270089091"),
    name: "Tom a' Choinich",
    elevationM: 1112,
    lat: 57.2995398,
    lng: -5.0489592,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "270089091",
  },
  {
    id: deterministicOsmDestinationId("304802133"),
    name: "Braigh Coire Chruinn-bhalgain",
    elevationM: 1070,
    lat: 56.831175,
    lng: -3.7297152,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "304802133",
  },
  {
    id: deterministicOsmDestinationId("382983155"),
    name: "Mullach Clach a' Bhlair",
    elevationM: 1019,
    lat: 57.0119137,
    lng: -3.8412449,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "382983155",
  },
  {
    id: deterministicOsmDestinationId("487767398"),
    name: "Carn an Tuirc",
    elevationM: 1019,
    lat: 56.9081726,
    lng: -3.3576721,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "487767398",
  },
  {
    id: deterministicOsmDestinationId("266821659"),
    name: "Spidean Coire nan Clach",
    elevationM: 993,
    lat: 57.58216,
    lng: -5.4036409,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "266821659",
  },
  {
    id: deterministicOsmDestinationId("273931436"),
    name: "Meall Buidhe",
    elevationM: 932,
    lat: 56.6172527,
    lng: -4.4485826,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "273931436",
  },
  {
    id: deterministicOsmDestinationId("268239549"),
    name: "Tom na Gruagaich",
    elevationM: 922,
    lat: 57.580525,
    lng: -5.5819472,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "268239549",
  },
  {
    id: deterministicOsmDestinationId("273884133"),
    name: "Carn Sgulain",
    elevationM: 920,
    lat: 57.1243293,
    lng: -4.1770213,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "273884133",
  },
  {
    id: deterministicOsmDestinationId("304798882"),
    name: "Carn Liath",
    elevationM: 975,
    lat: 56.8077815,
    lng: -3.7441007,
    countryCode: "GB",
    stateCode: "SCT",
    osmId: "304798882",
  },
  {
    id: deterministicOsmDestinationId("357728030"),
    name: "Sugarloaf",
    elevationM: 1128.7,
    lat: 44.7442504,
    lng: -71.4678332,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357728030",
  },
  {
    id: deterministicOsmDestinationId("357730837"),
    name: "Mount Success",
    elevationM: 1094.8,
    lat: 44.471448,
    lng: -71.038965,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730837",
  },
  {
    id: deterministicOsmDestinationId("357730205"),
    name: "Jennings Peak",
    elevationM: 1064.7,
    lat: 43.911119,
    lng: -71.5107376,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730205",
  },
  {
    id: deterministicOsmDestinationId("357730806"),
    name: "Stairs Mountain",
    elevationM: 1057.4,
    lat: 44.1550674,
    lng: -71.3184077,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730806",
  },
  {
    id: deterministicOsmDestinationId("357738724"),
    name: "North Percy Peak",
    elevationM: 1040.9,
    lat: 44.6631414,
    lng: -71.4351152,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357738724",
  },
  {
    id: deterministicOsmDestinationId("357730664"),
    name: "Mount Resolution",
    elevationM: 1044.2,
    lat: 44.147549,
    lng: -71.3140205,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730664",
  },
  {
    id: deterministicOsmDestinationId("357723734"),
    name: "Magalloway Mountain",
    elevationM: 1031.7,
    lat: 45.0635284,
    lng: -71.1623617,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357723734",
  },
  {
    id: deterministicOsmDestinationId("6733156563"),
    name: "Mount Tremont",
    elevationM: 1031.4,
    lat: 44.0533968,
    lng: -71.3569664,
    countryCode: "US",
    stateCode: "NH",
    osmId: "6733156563",
  },
  {
    id: deterministicOsmDestinationId("7471940749"),
    name: "Middle Sister",
    elevationM: 1018,
    lat: 43.964824,
    lng: -71.2701915,
    countryCode: "US",
    stateCode: "NH",
    osmId: "7471940749",
  },
  {
    id: deterministicOsmDestinationId("357725208"),
    name: "Owlshead",
    elevationM: 993,
    lat: 44.33869,
    lng: -71.4922013,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357725208",
  },
  {
    id: deterministicOsmDestinationId("357730467"),
    name: "North Moat Mountain",
    elevationM: 976.3,
    lat: 44.0431139,
    lng: -71.2146341,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730467",
  },
  {
    id: deterministicOsmDestinationId("5053030802"),
    name: "Imp Face",
    elevationM: 964.7,
    lat: 44.3215956,
    lng: -71.1880759,
    countryCode: "US",
    stateCode: "NH",
    osmId: "5053030802",
  },
  {
    id: deterministicOsmDestinationId("357729868"),
    name: "Mount Crawford",
    elevationM: 953.4,
    lat: 44.136672,
    lng: -71.3324071,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357729868",
  },
  {
    id: deterministicOsmDestinationId("6549196728"),
    name: "Mount Paugus (South Peak)",
    elevationM: 944.9,
    lat: 43.946339,
    lng: -71.3280075,
    countryCode: "US",
    stateCode: "NH",
    osmId: "6549196728",
  },
  {
    id: deterministicOsmDestinationId("357730460"),
    name: "North Doublehead",
    elevationM: 929.9,
    lat: 44.1677303,
    lng: -71.1301659,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730460",
  },
  {
    id: deterministicOsmDestinationId("357730768"),
    name: "South Doublehead",
    elevationM: 895.8,
    lat: 44.1615091,
    lng: -71.1318516,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730768",
  },
  {
    id: deterministicOsmDestinationId("6524294324"),
    name: "Eagle Crag",
    elevationM: 920.5,
    lat: 44.2536164,
    lng: -71.0716283,
    countryCode: "US",
    stateCode: "NH",
    osmId: "6524294324",
  },
  {
    id: deterministicOsmDestinationId("357730528"),
    name: "Mount Parker",
    elevationM: 918.4,
    lat: 44.1234014,
    lng: -71.298407,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730528",
  },
  {
    id: deterministicOsmDestinationId("357726689"),
    name: "Rogers Ledge",
    elevationM: 903.7,
    lat: 44.5500815,
    lng: -71.3618778,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357726689",
  },
  {
    id: deterministicOsmDestinationId("357724573"),
    name: "Mount Cube (South Peak)",
    elevationM: 888.8,
    lat: 43.8857394,
    lng: -72.0234745,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357724573",
  },
  {
    id: deterministicOsmDestinationId("357730826"),
    name: "Stinson Mountain",
    elevationM: 880.9,
    lat: 43.8346816,
    lng: -71.779109,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730826",
  },
  {
    id: deterministicOsmDestinationId("357731057"),
    name: "Mount Willard",
    elevationM: 868.7,
    lat: 44.2039569,
    lng: -71.4130896,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357731057",
  },
  {
    id: deterministicOsmDestinationId("357729691"),
    name: "Black Mountain (Benton)",
    elevationM: 862.3,
    lat: 44.0746111,
    lng: -71.9222486,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357729691",
  },
  {
    id: deterministicOsmDestinationId("357730772"),
    name: "South Moat Mountain",
    elevationM: 844.9,
    lat: 44.0174963,
    lng: -71.1934905,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730772",
  },
  {
    id: deterministicOsmDestinationId("357730183"),
    name: "Iron Mountain",
    elevationM: 830,
    lat: 44.1341559,
    lng: -71.23904,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730183",
  },
  {
    id: deterministicOsmDestinationId("357729906"),
    name: "Dickey Mountain",
    elevationM: 829.7,
    lat: 43.9230244,
    lng: -71.578652,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357729906",
  },
  {
    id: deterministicOsmDestinationId("357731016"),
    name: "Welch Mountain",
    elevationM: 791.9,
    lat: 43.9191721,
    lng: -71.5757055,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357731016",
  },
  {
    id: deterministicOsmDestinationId("357730623"),
    name: "Potash Mountain",
    elevationM: 820.2,
    lat: 43.9820417,
    lng: -71.3906357,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730623",
  },
  {
    id: deterministicOsmDestinationId("357730876"),
    name: "Table Mountain",
    elevationM: 813.5,
    lat: 44.0318399,
    lng: -71.2624659,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730876",
  },
  {
    id: deterministicOsmDestinationId("357730190"),
    name: "Mount Israel",
    elevationM: 803.5,
    lat: 43.8456274,
    lng: -71.4718248,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730190",
  },
  {
    id: deterministicOsmDestinationId("357730106"),
    name: "Mount Hayes",
    elevationM: 784.3,
    lat: 44.4156619,
    lng: -71.1598553,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730106",
  },
  {
    id: deterministicOsmDestinationId("357730558"),
    name: "Mount Pemigewasset",
    elevationM: 777.8,
    lat: 44.0978443,
    lng: -71.6989723,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730558",
  },
  {
    id: deterministicOsmDestinationId("357730120"),
    name: "Hedgehog Mountain",
    elevationM: 775.1,
    lat: 43.9742242,
    lng: -71.3671683,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730120",
  },
  {
    id: deterministicOsmDestinationId("357724126"),
    name: "Middle Sugarloaf",
    elevationM: 773.6,
    lat: 44.251466,
    lng: -71.5175639,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357724126",
  },
  {
    id: deterministicOsmDestinationId("357729606"),
    name: "Bald Peak",
    elevationM: 751.3,
    lat: 44.1479914,
    lng: -71.7517612,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357729606",
  },
  {
    id: deterministicOsmDestinationId("357730602"),
    name: "Pine Mountain (Gorham)",
    elevationM: 732.7,
    lat: 44.3658751,
    lng: -71.2151869,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730602",
  },
  {
    id: deterministicOsmDestinationId("357730571"),
    name: "Mount Percival",
    elevationM: 670.6,
    lat: 43.8096253,
    lng: -71.5570976,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730571",
  },
  {
    id: deterministicOsmDestinationId("357730420"),
    name: "Mount Morgan",
    elevationM: 674.5,
    lat: 43.8039009,
    lng: -71.5661669,
    countryCode: "US",
    stateCode: "NH",
    osmId: "357730420",
  },
];

export const CURATED_LISTS: CuratedList[] = [
  {
    listId: "ULCGhLnsWcYYRqXQ3aOo",
    sourceListId: 5044,
    name: "Cascade Volcanoes",
    description:
      "The Mountaineers' Tacoma branch created this peak pin in 2010 for climbers who reach all " +
      "twenty major Cascade volcanoes. The line runs from Mount Garibaldi in British Columbia " +
      "south to Lassen Peak in California. Every peak counts toward the pin; there is no partial credit.",
    expectedCount: 20,
    destinationOverrides: {},
    yearEstablished: 2010,
    organization: "The Mountaineers",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5044",
    region: "Cascades",
  },
  {
    listId: "LAZcIKjluO0oT3o9g6MC",
    sourceListId: 21360,
    name: "Colorado 14ers",
    description:
      "Colorado holds fifty-three peaks above 14,000 feet that also rise 300 feet above the " +
      "saddle linking them to a higher neighbor. Other Colorado summits clear 14,000 feet but " +
      "fall short of that rise, so lists count them as shoulders rather than mountains of their " +
      "own. Mount Elbert is the highest of them, and the highest summit in the Rocky Mountains.",
    expectedCount: 53,
    destinationOverrides: {
      5907: CRESTONE_PEAK_ID, // Crestone Peak East stands in for the catalog's west summit
      5676: "PaeawK81bgByWN53rffv", // Mount Blue Sky -> Mount Evans
    },
    // Nullable by design: a plain elevation/prominence cut has no keeper. Peakbagger hosts
    // the list but is not its keeper; that fact lives in sourceName/sourceUrl instead.
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21360",
    region: "Colorado",
  },
  {
    listId: "3S29a3viZKKnSMz4wzPQ",
    sourceListId: 21457,
    name: "Tennessee 4500ft Peaks",
    description:
      "Fifty-five summits in and around Tennessee reach 4,500 feet. Many sit on the crest of " +
      "the Great Smoky Mountains, where the state line follows the ridge shared with North " +
      "Carolina. Kuwohi, at 6,643 feet, is the highest of them and the highest point in Tennessee.",
    expectedCount: 55,
    destinationOverrides: {
      7764: "fC9zpl4WpEUZvU4HTsSI", // Kuwohi -> the existing Clingmans Dome row
      18611: HIGH_ROCK_ID,
    },
    // Nullable by design: another plain elevation cut with no keeper (see Colorado 14ers above).
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21457",
    region: "Tennessee",
  },
  {
    listId: deterministicListId(50081),
    sourceListId: 50081,
    name: "California Fourteeners",
    description:
      "Steve Porcella and Cameron Burns counted fifteen California summits above 14,000 feet " +
      "in their guidebook, first published in 1991. Fourteen rise in the Sierra Nevada; White " +
      "Mountain Peak stands alone east of the Owens Valley. Mount Whitney is the highest of the " +
      "fifteen, and of the contiguous United States.",
    expectedCount: 15,
    destinationOverrides: {},
    yearEstablished: 1991,
    organization: "Porcella and Burns",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=50081",
    region: "California",
  },
  {
    listId: deterministicListId(50511),
    sourceListId: 50511,
    name: "Sierra Peaks Section Emblem Peaks",
    description:
      "The Sierra Club's Angeles Chapter founded the Sierra Peaks Section in 1955 and marked " +
      "fifteen summits on its peaks list as Emblem Peaks, the ones that dominate their part of " +
      "the range. A member earns the section emblem by climbing ten of the fifteen plus fifteen " +
      "more peaks from the full list. Mount Whitney, Mount Williamson, North Palisade, and Mount " +
      "Ritter are among them.",
    expectedCount: 15,
    destinationOverrides: {},
    yearEstablished: 1955,
    organization: "Sierra Club Angeles Chapter",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=50511",
    region: "Sierra Nevada",
  },
  {
    listId: deterministicListId(5051),
    sourceListId: 5051,
    name: "Sierra Peaks Section",
    description:
      "The Sierra Club's Angeles Chapter formed the Sierra Peaks Section in 1955 to explore " +
      "and climb the Sierra Nevada. Its list holds 247 active peaks, from Owens Peak in the " +
      "south to Adams Peak in the north, and spans routes from walk-ups to class 5 climbs. " +
      "Fifteen are Emblem Peaks; ten of those plus fifteen more list peaks earn the section emblem.",
    expectedCount: 247,
    destinationOverrides: {
      13567: "89lGAhqgSm18Jih8vRUk", // Sierra Buttes -> the existing Sierra Buttes Lookout row
      69023: "D80BD9D570012B82ED80", // Adams Peak - West Peak -> the existing Adams Peak row
    },
    yearEstablished: 1955,
    organization: "Sierra Club Angeles Chapter",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5051",
    region: "Sierra Nevada",
  },
  {
    listId: deterministicListId(5120),
    sourceListId: 5120,
    name: "Adirondack 46ers",
    description:
      "Bob and George Marshall and their guide Herbert Clark climbed all forty-six Adirondack " +
      "High Peaks between 1918 and 1925. Later surveys put four of the forty-six under 4,000 " +
      "feet and found one 4,000-foot summit the Marshalls had skipped, but the Adirondack " +
      "Forty-Sixers kept the original list. Mount Marcy, the highest point in New York, tops it.",
    expectedCount: 46,
    destinationOverrides: {
      6090: "8D80C88D491FB5DE4232", // Grace Mountain -> the existing Grace Peak row
    },
    yearEstablished: 1948,
    organization: "Adirondack Forty-Sixers",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5120",
    region: "Adirondacks",
  },
  {
    listId: deterministicListId(5163),
    sourceListId: 5163,
    name: "New England 4000-Footers",
    description:
      "The Appalachian Mountain Club's Four Thousand Footer Club drew up its New England list " +
      "in 1964, carrying the New Hampshire forty-eight across into Maine and Vermont. A summit " +
      "qualifies when it reaches 4,000 feet and stands 200 feet above the saddle linking it to " +
      "a higher neighbor. The list runs to sixty-seven peaks today, and Mount Washington tops it.",
    expectedCount: 67,
    destinationOverrides: {
      6919: NORTH_TWIN_MOUNTAIN_ID, // North Twin -> the OSM name, North Twin Mountain
      6926: BONDCLIFF_ID, // Bondcliffs -> the OSM name, Bondcliff
      6991: EAST_OSCEOLA_ID, // Mount Osceola - East Peak -> East Osceola
      6922: "C20C3828C69C89C5976A", // Zealand Mountain -> the existing Mount Zealand row
      6885: "CC78CA6F6F21ADF51013", // Old Speck -> the existing Old Speck Mountain row
      6850: "39176EE36B46BCC0E000", // Bigelow Mountain -> the existing Mount Bigelow row
      6847: "404A204B24580871F4B5", // Saddleback Mountain - The Horn -> the existing The Horn row
    },
    yearEstablished: 1964,
    organization: "AMC Four Thousand Footer Club",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5163",
    region: "New England",
  },
  {
    listId: deterministicListId(21316),
    sourceListId: 21316,
    name: "Oregon Top 100 Peaks",
    description:
      "This list runs from Mount Hood, the highest point in Oregon, down to a shade under " +
      "8,000 feet. The Cascade volcanoes take the top places, but the Wallowa Mountains in " +
      "the northeast corner hold the largest share of the list. Twenty of the hundred borrow " +
      "their name from a nearby landmark, most often a lake, and five carry nothing but an " +
      "elevation.",
    expectedCount: 100,
    destinationOverrides: {
      3337: KIGER_MANN_PEAK_ID, // Steens Mountain - North Peak
      36387: WEST_ANEROID_PEAK_ID, // Peak 9192
      107008: SNOWFIELD_PEAK_ID, // Peak 8963
      204076: "kkqii3pdy5RhZ8tyGcII", // Twin Mountain - East Peak -> the existing Twin Mountain row
      3165: MOCCASIN_LAKE_MOUNTAIN_ID, // Lostline River-Moccasin Lake
    },
    // Nullable by design: a plain elevation cut has no keeper (see Colorado 14ers above).
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21316",
    region: "Oregon",
  },
  {
    listId: deterministicListId(50083),
    sourceListId: 50083,
    name: "Traditional Colorado Centennials",
    description:
      "This list takes Colorado's hundred highest summits, counting only those that rise 300 " +
      "feet above the saddle linking them to a higher neighbor. It follows the older reckoning " +
      "from the USGS quadrangle surveys, which stood from 1977, when Spencer Swanger became " +
      "the first to climb them all, until airborne LiDAR reshuffled the ranks in 2021. Mount " +
      "Elbert leads it and Dallas Peak, at 13,809 feet, comes last.",
    expectedCount: 100,
    destinationOverrides: {
      5676: "PaeawK81bgByWN53rffv", // Mount Blue Sky -> the existing Mount Evans row
      5798: "CDtc6zwdcpVsT3kx1tgO", // Mount Buckskin - Southeast Peak -> the existing Mount Buckskin row
      5846: MARK_MOUNTAIN_ID, // Redcloud Peak - Northeast Peak -> Mark Mountain, UN 13,838
    },
    // Nullable by design: an elevation and prominence cut has no keeper. The
    // Colorado Mountain Club records finishers but does not draw the list.
    yearEstablished: 1977,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=50083",
    region: "Colorado",
  },
  {
    listId: deterministicListId(5167),
    sourceListId: 5167,
    name: "New Hampshire 4000-Footers",
    description:
      "The Appalachian Mountain Club founded its Four Thousand Footer Club in 1957 around this " +
      "list. A summit qualifies when it reaches 4,000 feet and rises 200 feet above the saddle " +
      "linking it to a higher neighbor. All forty-eight stand in the White Mountains, and Mount " +
      "Washington, the highest point in the Northeast, tops them.",
    expectedCount: 48,
    destinationOverrides: {
      6919: NORTH_TWIN_MOUNTAIN_ID, // North Twin -> the OSM name, North Twin Mountain
      6926: BONDCLIFF_ID, // Bondcliffs -> the OSM name, Bondcliff
      6991: EAST_OSCEOLA_ID, // Mount Osceola - East Peak -> East Osceola
      6922: "C20C3828C69C89C5976A", // Zealand Mountain -> the existing Mount Zealand row
    },
    yearEstablished: 1957,
    organization: "AMC Four Thousand Footer Club",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5167",
    region: "White Mountains",
  },
  {
    listId: deterministicListId(5130),
    sourceListId: 5130,
    name: "Catskill 3500",
    description:
      "The Catskill 3500 Club has taken members since 1962 for climbing the highest peaks on " +
      "public land in the Catskills. Its list held thirty-five summits until 2021, when " +
      "Doubletop and Graham closed to the public and left thirty-three. Members also climb " +
      "Slide, Blackhead, Balsam and Panther a second time in winter.",
    expectedCount: 33,
    destinationOverrides: {
      // Hunter Mountain - Southwest Peak -> the existing Southwest Hunter Mountain row
      7321: "67817E17AC761CD791CA",
      18321: "38F4020BB2AA21456FD3", // Indian Head -> the existing Indian Head Mountain row
    },
    yearEstablished: 1962,
    organization: "Catskill 3500 Club",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5130",
    region: "Catskills",
  },
  {
    listId: deterministicListId(5165),
    sourceListId: 5165,
    name: "New England Hundred Highest",
    description:
      "The AMC Four Thousand Footer Club added this list in 1967: the hundred highest summits " +
      "in New England, each standing 200 feet above the saddle linking it to a higher neighbor. " +
      "New England's sixty-seven 4,000-footers fill the top; the other thirty-three fall just " +
      "short. The club calls it the only one of its lists with true bushwhacks, and eleven of " +
      "those thirty-three have no trail at all.",
    expectedCount: 100,
    destinationOverrides: {
      6919: NORTH_TWIN_MOUNTAIN_ID, // North Twin -> the OSM name, North Twin Mountain
      6926: BONDCLIFF_ID, // Bondcliffs -> the OSM name, Bondcliff
      6991: EAST_OSCEOLA_ID, // Mount Osceola - East Peak -> East Osceola
      6922: "C20C3828C69C89C5976A", // Zealand Mountain -> the existing Mount Zealand row
      6885: "CC78CA6F6F21ADF51013", // Old Speck -> the existing Old Speck Mountain row
      6850: "39176EE36B46BCC0E000", // Bigelow Mountain -> the existing Mount Bigelow row
      6847: "404A204B24580871F4B5", // Saddleback Mountain - The Horn -> the existing The Horn row
      6880: SOUTH_WEEKS_MOUNTAIN_ID, // Mount Weeks - South Peak -> the OSM name, South Weeks Mountain
      6852: SOUTH_HORN_ID, // The Horns -> South Horn, the AMC's name for the higher of the pair
      6917: "ED29187EC4534680CEF4", // Nubble Peak -> the existing Peak Above the Nubble row
      6860: "8106CBEB89FCD5BEF1B4", // Elephant Mountain - Southwest Peak -> the existing Elephant Mountain row
    },
    yearEstablished: 1967,
    organization: "AMC Four Thousand Footer Club",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5165",
    region: "New England",
  },
  {
    listId: deterministicListId(511),
    sourceListId: 511,
    name: "Northeast 111",
    description:
      "This list gathers the Northeast's 4,000-footers into one: New England's sixty-seven, " +
      "the forty-six Adirondack High Peaks, and Slide and Hunter in the Catskills. It took its " +
      "name when the count was 111; later surveys promoted two more peaks in New Hampshire and " +
      "two in Maine, and the name stuck at 115. The AMC Four Thousand Footer Club recognizes " +
      "finishers, who must first join the New England and Adirondack clubs.",
    expectedCount: 115,
    destinationOverrides: {
      6919: NORTH_TWIN_MOUNTAIN_ID, // North Twin -> the OSM name, North Twin Mountain
      6926: BONDCLIFF_ID, // Bondcliffs -> the OSM name, Bondcliff
      6991: EAST_OSCEOLA_ID, // Mount Osceola - East Peak -> East Osceola
      6922: "C20C3828C69C89C5976A", // Zealand Mountain -> the existing Mount Zealand row
      6885: "CC78CA6F6F21ADF51013", // Old Speck -> the existing Old Speck Mountain row
      6850: "39176EE36B46BCC0E000", // Bigelow Mountain -> the existing Mount Bigelow row
      6847: "404A204B24580871F4B5", // Saddleback Mountain - The Horn -> the existing The Horn row
      6090: "8D80C88D491FB5DE4232", // Grace Mountain -> the existing Grace Peak row
    },
    yearEstablished: 1971,
    organization: "AMC Four Thousand Footer Club",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=511",
    region: "Northeast",
  },
  {
    listId: deterministicListId(5053),
    sourceListId: 5053,
    name: "Desert Peaks Section",
    description:
      "The Sierra Club's Angeles Chapter founded the Desert Peaks Section in 1941, the " +
      "oldest peak-climbing section in the chapter. Ninety-five desert mountains stand on " +
      "its list, spread across California, Nevada, Arizona, Utah and Mexico. Six of them " +
      "and a Sierra Club membership make a member of the section. White Mountain Peak, " +
      "east of the Owens Valley, is the highest.",
    expectedCount: 95,
    destinationOverrides: {
      13418: "8264B4AD714F0EA6E19E", // Weavers Needle -> the existing Weaver's Needle row
      3614: "WSfpljsS69KFXbCnDDcM", // Glass Mountain -> the nearer of two catalog rows so named
      3804: GRANITE_PEAK_ID, // Granite Mountain -> the OSM name, Granite Peak
      4173: SUPERSTITION_PEAK_ID, // Superstition Benchmark -> the OSM name, Superstition Peak
      13412: INDIAN_HEAD_PEAK_ID, // Indianhead -> the OSM name, Indian Head Peak
      16806: OROCOPIA_MOUNTAIN_ID, // Orocopia Mountains High Point -> the OSM name
    },
    yearEstablished: 1941,
    organization: "Sierra Club Angeles Chapter",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5053",
    region: "Desert Southwest",
  },
  {
    listId: deterministicListId(5052),
    sourceListId: 5052,
    name: "Hundred Peaks Section",
    description:
      "Weldon Heald, Luella Todd and Jack Bascom published the first Hundred Peaks Game list " +
      "in 1946. The Sierra Club's Angeles Chapter made the group an official section in 1954. " +
      "Its current list holds 280 Southern California summits, each above 5,000 feet, and " +
      "recognizes climbers at 100 peaks, 200 peaks and completion of the full list.",
    expectedCount: 280,
    destinationOverrides: {
      1452: "B5EC8D01243FC4D046E8", // Palomar Mountain -> the existing OSM High Point row
    },
    yearEstablished: 1946,
    organization: "Sierra Club Angeles Chapter",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5052",
    region: "Southern California",
  },
  {
    listId: deterministicListId(5055),
    sourceListId: 5055,
    name: "Tahoe Ogul Peaks",
    description:
      "Members of the Sierra Club's Peak and Gorge Section drew up this list of sixty-three " +
      "peaks around Lake Tahoe in the early 1980s. Ogul is the Washoe word for the mountain " +
      "bighorn sheep that once ranged there. The section disbanded in 1998, and the Western " +
      "States Climbers have kept the list since 2000; it carries no Sierra Club tie today. " +
      "Fifty-six of the peaks stand in California and seven in Nevada.",
    expectedCount: 63,
    destinationOverrides: {
      3607: "dQvlhlqanHJh4h4JSkP7", // Middle Sister -> the existing row, whose elevation this pass corrects
      13567: "89lGAhqgSm18Jih8vRUk", // Sierra Buttes -> the existing Sierra Buttes Lookout row
      69023: "D80BD9D570012B82ED80", // Adams Peak - West Peak -> the existing Adams Peak row
      53297: SILVER_PEAK_SIERRA_ID, // Silver Peak - Southwest Summit -> the OSM name, Silver Peak
      26373: WADE_PEAK_ID, // Wade Benchmark -> the OSM name, Wade Peak
    },
    // Nullable by design: the list dates from the early 1980s and no source gives a year.
    yearEstablished: null,
    organization: "Western States Climbers",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5055",
    region: "Lake Tahoe",
  },
  {
    listId: deterministicListId(5180),
    sourceListId: 5180,
    name: "South Beyond 6000",
    description:
      "The Carolina Mountain Club and the Tennessee Eastman Hiking and Canoeing Club have " +
      "run this challenge since 1968. More than sixty Southern Appalachian summits pass " +
      "6,000 feet; forty qualify, each dropping 200 feet to the saddle joining it to " +
      "another qualifier or standing three quarters of a mile from one. They fall in six " +
      "ranges: the Smokies, Plotts, Balsams, Craggies, Blacks and Roans. All but Mount Le " +
      "Conte lie in North Carolina or on its line with Tennessee.",
    expectedCount: 40,
    destinationOverrides: {
      7764: "fC9zpl4WpEUZvU4HTsSI", // Kuwohi -> the existing Clingmans Dome row
      7823: HALLBACK_ID, // Mount Hallback -> the OSM name, Hallback
      7830: PLOTT_BALSAM_ID, // Plott Balsam Mountain -> the OSM name, Plott Balsam
    },
    yearEstablished: 1968,
    organization: "Carolina Mountain Club and Tennessee Eastman Hiking and Canoeing Club",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5180",
    region: "Southern Appalachians",
  },
  {
    listId: deterministicListId(21330),
    sourceListId: 21330,
    name: "Idaho 12ers",
    description:
      "Idaho holds nine ranked summits above 12,000 feet. Seven stand in the Lost River " +
      "Range, one in the Lemhi Range and one in the Pioneer Mountains. Borah Peak leads " +
      "them and is the highest point in the state. Two more Idaho summits clear 12,000 " +
      "feet but rise less than 300 feet above the saddle joining them to a higher " +
      "neighbor, so they count as shoulders rather than peaks of their own.",
    expectedCount: 9,
    // Peakbagger has no Idaho 12,000-foot list. These nine are the ranked rows at or
    // above 12,000 feet on its Idaho 11,000-foot page, in the order that page prints
    // them; sourceRowCount re-checks that the page itself has not changed.
    sourcePeakIds: [5142, 5147, 5164, 5150, 5151, 5145, 5154, 5152, 5118],
    sourceRowCount: 138,
    destinationOverrides: {},
    // Nullable by design: a plain elevation cut has no keeper (see Colorado 14ers above).
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21330",
    region: "Idaho",
  },
  {
    listId: deterministicListId(200),
    sourceListId: 200,
    name: "Classic 8000-Meter Peaks",
    description:
      "The UIAA recognizes fourteen classic mountains whose main summits rise above 8,000 " +
      "meters. They stand in the Himalaya and Karakoram across Nepal, China, Pakistan and " +
      "India. Mount Everest is the highest and Shishapangma the lowest. Higher subsidiary " +
      "summits remain part of their parent mountains rather than separate entries.",
    expectedCount: 14,
    // The source page also shows nine unranked subsidiary summits above 8,000 metres.
    // Pin the fourteen main summits while sourceRowCount guards the whole page.
    sourcePeakIds: [
      10640, 10515, 10653, 10642, 10649, 10634, 10620,
      10627, 10603, 10621, 10527, 10519, 10525, 10631,
    ],
    sourceRowCount: 23,
    // These exact-name catalog rows predate country-code backfill. Pin their reviewed
    // identities so the geographic scope stays strict for every other row.
    destinationOverrides: {
      10642: "8ObhH1SFcbVyfFLOkUzA", // Lhotse
      10649: "CMzSuY3q2RqUlor9ATeB", // Makalu
      10634: "LB5NjLmbUixWZPhAT2EP", // Cho Oyu
      10627: "nh9RfheEwRlCRUfYBULo", // Manaslu
      10603: "t2utGd2uMc9LJwkW2MeF", // Nanga Parbat
      10621: "CJvnAqwqxztFb0sZIPnS", // Annapurna
      10527: "h5rpyI7FZrzCMETj1fQw", // Gasherbrum I
      10519: "U9zqKEzWFkHkukEF7enG", // Broad Peak
      10525: "Bpd52aU5hQ953DGDgwOG", // Gasherbrum II
      10631: "ojZjwxp0vjfygs6insL4", // Shishapangma
    },
    allowedCountryCodes: ["CN", "IN", "NP", "PK"],
    yearEstablished: null,
    organization: "International Climbing and Mountaineering Federation (UIAA)",
    sourceName: "UIAA",
    sourceUrl: "https://www.theuiaa.org/uiaa-position-on-8000m-peaks/",
    region: "Himalaya and Karakoram",
  },
  {
    listId: deterministicListId(5410),
    sourceListId: 5410,
    name: "UIAA Alpine 4000ers",
    description:
      "The UIAA and Club Alpino Italiano published this official list of eighty-two Alpine " +
      "summits in 1994. Each rises above 4,000 meters and qualifies through a mix of " +
      "topographic separation, the shape of the summit and its place in mountaineering. " +
      "Mont Blanc is the highest.",
    expectedCount: 82,
    destinationOverrides: {
      10043: "F548D297513AF1CE3097",
      10041: "E0976360E84FFAF26F0C",
      10045: "D3B27AEDEE1A5B69A115",
      10038: "3F60DD2DAFDE455A4A3A",
      10037: "E936E0A87A157AF3F7EB",
      9944: "A3B88FF39BF3E9580527",
      10046: "E4B16FA4B24BE7E57117",
      10023: "022EE491C72EF55C159B",
      9939: "xwI4EU0yhpLz9qIY0BEx",
      9932: "5BF88F7B2BC009D5D165",
      18883: "DF1B6DE4ACFC4BA0A053",
      19102: "C7081446CE83AB97E74D",
      10034: "1337EEA43E69E81D5648",
      10035: "7113D1644ABC0ED123E2",
      88874: "8A4F8CF690E2B486CCE6",
      18884: "C61DD9AC5428D592DB10",
      88779: "9A0174F143F8E6C9B66B",
      9943: "701B0F8C662F61CC2B88",
      35251: "38DFBDEF4B7813290EC6",
      88806: "6CB89FE3704276C077AE",
      88778: "BA26988ABD3CFFD0D97F",
      88780: "A46CD13CD01E409BE23F",
      88781: "821D79A7EA58B6CC2FF3",
      35253: "25F935E6A04D8CA9A970",
      9940: "8DE6B084BAB8E877485F",
      35252: "3063972FB44853602BD4",
      9968: "D8635684956DD480DDC9",
      10051: "692F5E55922EA0A1FAF3",
      9946: "BA738D3FA975A9E531E3",
      88873: "90543AAF5EF4EE69A50F",
    },
    allowedCountryCodes: ["CH", "FR", "IT"],
    yearEstablished: 1994,
    organization: "International Climbing and Mountaineering Federation (UIAA)",
    sourceName: "UIAA",
    sourceUrl: "https://www.theuiaa.org/4000-alps/",
    region: "Alps",
  },
  {
    listId: deterministicListId(5521),
    sourceListId: 5521,
    name: "Munros",
    description:
      "Sir Hugh Munro published the first table of Scottish mountains above 3,000 feet in " +
      "the Scottish Mountaineering Club Journal in 1891. The club still keeps the list and " +
      "updates it when nationally recognized survey data changes. It now holds 282 peaks, " +
      "with Ben Nevis at the top.",
    expectedCount: 282,
    destinationOverrides: {
      9215: "AEE95A0D183D5B38CDA9",
      9205: "AFACCEA4803C550DE613",
      9239: "E1B2FE58EF064633A656",
      9249: "A12350AFB341652B20AC",
      9193: "DE24842D485ADFBA9B04",
      9259: "13CC4E51C4B474A288AA",
      9252: "33B48D29DF91A0FEC722",
      9180: "673767973B3E21843692",
      9242: "497EA0B52BC552B95CFB",
      9168: "236C58CBDF82F1C2D134",
      15249: "36FC5F787D910149B5F9",
      15296: "89964D6D4D311B3E0FF6",
      9167: "69FE0855EDD11C378FCC",
      20990: "1F047C2D57CC6FA5E79B",
      9173: "E4158C018AD94985F9F7",
      6489: "B2BAC010669454711FA5",
      20373: "FB6C9F7962119EF89784",
      21182: "52DE809AB1BA1A592906",
      19454: "12416202A93497B2BD49",
      9191: "477D8BE9AFEBFAEF00EE",
      14302: "56A1D37A11147D97C56B",
      14061: "CB769141BE79363B9F3C",
      21131: "024A33ACF82A7D951984",
      9279: "FD0D71E379906C231EFA",
      21040: "B613E04D54A57E870BD9",
      21073: "6F3D110EA0B2255E832F",
      14056: "ACBD145E5EFCE9F6F2D4",
      9245: "6057D6CB6A68989E25A9",
      19361: "28CF177C71D3F5EFBB4B",
      14614: "08EE91AC6B3549E42A28",
      14994: "A1518D221BDE5B8B0204",
      15058: "27B5F798290CCD16989F",
      15673: "F54B5339C4DA59B35CE0",
      14497: "3F8CB8B705D4F87A93F3",
      19288: "1E93B591184E6D60BEBA",
      15664: "7EA81F5E082202E5269F",
      21183: "BD14A625965E628F8AA8",
      9243: "07D9E635C667C3E52129",
      14086: "053E514768574C108BA9",
      19160: "84A8714C2413CDD0AC23",
      9300: "74DC4C8B839711CC37FA",
      21005: "DBCE45EDBAECBE497FD1",
      19168: "4839F06B3B6622FD0E6D",
      9274: "FC801358557A42E1C5CA",
      21215: "2CF63B8AE97D8FA7D24A",
      14065: "2C8FF1E3BABEC382A8D1",
      9159: "6BB4C4ADCF7CE513CD3E",
      14327: "49EF083D6E491B3A62DE",
      14429: "95931126A2B07E97DA08",
      15330: "57ADEA80F7825441520A",
      15464: "41BC1AF16312152B3B33",
      21196: "E4836090DFCB3A6DED85",
      14076: "2AB3C3CD716D20119270",
      9210: "EFDA79F2B21100293B6F",
      14346: "36F07CBFD7A8B5B54D68",
      15637: "5A4A45C8697D39E34C26",
      14068: "FCB67F966010A629B375",
      15410: "405499ED8299769A756D",
      14540: "71EF850504E8E081B428",
      21057: "30EC4DE16D2E4CF1B295",
      9136: "5992522C76E52A324191",
      21230: "173888C9FC0F4875478A",
      21085: "03C73644AEFC9EFCF3EA",
      19156: "9A208A732962540F01FA",
      21064: "6E44A1C36E9D2303A107",
      21022: "EBCC6E424AEDA14E19D0",
      21249: "9BC4D162C8A4107FBB4D",
      19285: "EABC0375E2D1017B94E4",
      19261: "2E7F19EE529C76EA3D11",
      21247: "7A534022D5B979EC75FD",
      15373: "1ED4749A25EA3AC87669",
    },
    allowedCountryCodes: ["GB"],
    yearEstablished: 1891,
    organization: "Scottish Mountaineering Club",
    sourceName: "Scottish Mountaineering Club",
    sourceUrl: "https://www.smc.org.uk/hills/",
    region: "Scotland",
  },
  {
    listId: deterministicListId(5170),
    sourceListId: 5170,
    name: "New Hampshire 52 With a View",
    description:
      "The Over the Hill Hikers created this set of fifty-two scenic New Hampshire hikes " +
      "below 4,000 feet in 1990. The group remains its official keeper and revised the list " +
      "in June 2025 as views and trail access changed. Two hikes pair neighboring summits, " +
      "so Peaks links all fifty-four named mountains. Sandwich Mountain is the highest.",
    expectedCount: 54,
    // Peakbagger represents each paired hike with one summit. The keeper names both North
    // and South Doublehead, and both Welch and Dickey, so add the companion summits while
    // sourceRowCount pins the public source page at 52 rows.
    sourceRowCount: 52,
    supplementalSourcePeaks: [
      {
        ordinal: 27,
        peakbaggerPeakId: 12604,
        name: "South Doublehead",
        elevationFt: 2939.2,
        lat: 44.16081,
        lng: -71.13074,
      },
      {
        ordinal: 40,
        peakbaggerPeakId: 23554,
        name: "Welch Mountain",
        elevationFt: 2598.3,
        lat: 43.91902,
        lng: -71.57597,
      },
    ],
    destinationOverrides: {
      18307: "97D3BF7A363A69E7A25C",
      6890: "B36E1759B0B90677B183",
      12517: "70A431CC2C5ABC03D25F",
      12612: "2333E3B78B48835DB16D",
      18308: "AB1D2D1B63BDEF2DB37C",
      136676: "CB5031CB5F046F9DF2B9",
      12524: "23EF14B16A3B68AB5D3C",
      12565: "F3B21A7846DF9DDF2261",
      12621: "A2A9168E3FFD9283E6AE",
      12480: "436BFD7BD7EF6C559073",
      6946: "08DE8EA53FDA8A1B13C1",
      12515: "640FC0DB37D13100C34B",
      12533: "A06D5F9ACA44A6F6917F",
      32002: "9F03EBA3D0556E1A9E83",
      12573: "5F65FEB127B9291ACC94",
      12604: "5164F45BA7CE61C7C1E6",
      23548: "3FF986495C90526E0921",
      12552: "8C80BBA316EDCEF5403E",
      28966: "3203FCB5B3AAE6F1835C",
      6733: "89ED4A090E1D8D7E6CFF",
      12614: "399BF3025EA1EED9B1BA",
      6929: "E07BD8C03367A765B02D",
      12462: "3A3911DFA37388433FFA",
      12605: "896466B268089D2E93D2",
      12516: "AE4E7281A5DB217FCFC0",
      12491: "CCB741DCE053A83C86B9",
      23554: "B41DEC160A279FB18A9F",
      12584: "A5C8CEAF9F5EE51A7FA6",
      42616: "42EA497ECA3A272AF608",
      23550: "2CC70D486AE1E319E10D",
      6893: "ACE73C66F4880A472AA5",
      12554: "4ADF3F51E4A0D5030995",
      12508: "88C35DCE45F1CEFEA636",
      12526: "5631520326CAF92AE723",
      25448: "3B4D15F7E8E5D12FC8FD",
      6949: "B01A788B56CF2D3F2B17",
      12555: "B3BF90D9B3A21F26F0EB",
      12549: "72E9F6A57DFC7EA5D6BA",
    },
    allowedCountryCodes: ["US"],
    allowedStateCodes: ["NH"],
    yearEstablished: 1990,
    organization: "Over the Hill Hikers",
    sourceName: "Over the Hill Hikers",
    sourceUrl: "https://overthehillhikers.blogspot.com/p/official-52-with-view-list.html",
    region: "New Hampshire",
  },
];

export function parseArgs(argv = process.argv.slice(2)): ImportArgs {
  const inputArg = argv.find((arg) => arg.startsWith("--input="));
  const input = inputArg?.slice("--input=".length).trim();
  if (!input) throw new Error("--input is required");
  const unknown = argv.filter((arg) => arg !== "--apply" && !arg.startsWith("--input="));
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  return { input, apply: argv.includes("--apply") };
}

export function normalizeListPeakName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[\u2010-\u2015-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function haversineMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateSourceList(list: CuratedList, source: PeakbaggerSourceList): void {
  if (!source || !Array.isArray(source.rows)) {
    throw new Error(`Peakbagger list ${list.sourceListId} is missing from the input`);
  }
  const selection = list.sourcePeakIds;
  const supplements = list.supplementalSourcePeaks ?? [];
  const hasAdjustedMembership = selection != null || supplements.length > 0;
  if (hasAdjustedMembership !== (list.sourceRowCount != null)) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} needs sourceRowCount with adjusted membership`
    );
  }
  const expectedRows = list.sourceRowCount ?? list.expectedCount;
  if (source.rows.length !== expectedRows) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} has ${source.rows.length} rows; ` +
      `expected ${expectedRows}`
    );
  }
  if (
    list.completionTarget != null &&
    normalizeStoredListCompletionTarget(list.completionTarget, list.expectedCount) == null
  ) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} completion target must be between 1 and ` +
      `${list.expectedCount}`
    );
  }
  const peakIds = new Set<number>();
  for (const row of source.rows) {
    if (!Number.isInteger(row.peakbaggerPeakId) || row.peakbaggerPeakId <= 0) {
      throw new Error(`List ${list.sourceListId} has an invalid peak ID`);
    }
    if (!Number.isInteger(row.ordinal) || row.ordinal <= 0) {
      throw new Error(`List ${list.sourceListId} peak ${row.peakbaggerPeakId} has an invalid ordinal`);
    }
    if (!row.name?.trim() || !Number.isFinite(row.elevationFt)) {
      throw new Error(`List ${list.sourceListId} peak ${row.peakbaggerPeakId} is incomplete`);
    }
    if (peakIds.has(row.peakbaggerPeakId)) {
      throw new Error(`List ${list.sourceListId} repeats peak ${row.peakbaggerPeakId}`);
    }
    peakIds.add(row.peakbaggerPeakId);
  }
  const supplementalIds = new Set<number>();
  for (const row of supplements) {
    if (!Number.isInteger(row.peakbaggerPeakId) || row.peakbaggerPeakId <= 0 ||
        !Number.isInteger(row.ordinal) || row.ordinal <= 0 ||
        !row.name?.trim() || !Number.isFinite(row.elevationFt)) {
      throw new Error(`List ${list.sourceListId} has an invalid supplemental peak`);
    }
    if (peakIds.has(row.peakbaggerPeakId) || supplementalIds.has(row.peakbaggerPeakId)) {
      throw new Error(`List ${list.sourceListId} repeats supplemental peak ${row.peakbaggerPeakId}`);
    }
    supplementalIds.add(row.peakbaggerPeakId);
  }
  if (selection != null && new Set(selection).size !== selection.length) {
    throw new Error(`Peakbagger list ${list.sourceListId} repeats selected peaks`);
  }
  const selectedCount = selection?.length ?? source.rows.length;
  if (selectedCount + supplements.length !== list.expectedCount) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} resolves ${selectedCount + supplements.length} peaks; ` +
      `expected ${list.expectedCount}`
    );
  }
  const absent = selection?.find((peakId) => !peakIds.has(peakId));
  if (absent != null) {
    throw new Error(`Peakbagger list ${list.sourceListId} is missing selected peak ${absent}`);
  }
}

function selectedSourceRows(
  list: CuratedList,
  source: PeakbaggerSourceList
): PeakbaggerSourcePeak[] {
  const selection = list.sourcePeakIds == null ? null : new Set(list.sourcePeakIds);
  const selectedRows = selection == null
    ? source.rows
    : source.rows.filter((row) => selection.has(row.peakbaggerPeakId));
  return [...selectedRows, ...(list.supplementalSourcePeaks ?? [])]
    .sort((left, right) => left.ordinal - right.ordinal);
}

function resolveExactNameCandidate(
  source: PeakbaggerSourcePeak,
  catalog: CatalogPeak[],
  list: CuratedList
): CatalogPeak {
  const normalizedName = normalizeListPeakName(source.name);
  const sourceElevationM = source.elevationFt * METERS_PER_FOOT;
  const exactCandidates = catalog.filter((peak) =>
    normalizeListPeakName(peak.name) === normalizedName &&
    peak.elevationM != null &&
    Math.abs(peak.elevationM - sourceElevationM) <= MAX_ELEVATION_DELTA_M
  );
  let candidates = exactCandidates.filter((peak) =>
    (list.allowedCountryCodes == null ||
      (peak.countryCode != null && list.allowedCountryCodes.includes(peak.countryCode))) &&
    (list.allowedStateCodes == null ||
      (peak.stateCode != null && list.allowedStateCodes.includes(peak.stateCode)))
  );

  // The distance bound applies to every candidate, not just to a tie. A lone
  // match that sits far away is a wrong match, not a winner: Peaks once held
  // only the Armstrong Mountain in Washington, and the Adirondack row took it
  // from 3,460 km away because a single candidate never reached this rule.
  if (Number.isFinite(source.lat) && Number.isFinite(source.lng)) {
    const measured = candidates
      .map((peak) => ({ peak, distanceM: haversineMeters(source as Required<PeakbaggerSourcePeak>, peak) }))
      .sort((left, right) => left.distanceM - right.distanceM);
    const near = measured.filter(({ distanceM }) => distanceM <= MAX_SPATIAL_TIEBREAK_M);
    if (near.length === 0 && measured.length > 0) {
      const details = measured
        .map(({ peak, distanceM }) => `${peak.id}:${peak.name} ${(distanceM / 1_000).toFixed(1)} km away`)
        .join(", ");
      throw new Error(
        `List peak ${source.peakbaggerPeakId} ${source.name} matched no destination ` +
        `within ${MAX_SPATIAL_TIEBREAK_M / 1_000} km (${details})`
      );
    }
    candidates = near.map(({ peak }) => peak);
  }

  if (candidates.length !== 1) {
    let details = candidates.map((peak) => `${peak.id}:${peak.name}`).join(", ") || "none";
    if (candidates.length === 0 && exactCandidates.length > 0) {
      const unscoped = exactCandidates.map((peak) =>
        `${peak.id}:${peak.name}:${peak.countryCode ?? "?"}/${peak.stateCode ?? "?"}`
      ).join(", ");
      details += `; unscoped ${unscoped}`;
    }
    throw new Error(
      `List peak ${source.peakbaggerPeakId} ${source.name} resolved to ` +
      `${candidates.length} destinations (${details})`
    );
  }
  return candidates[0];
}

export function resolveListMembers(
  list: CuratedList,
  source: PeakbaggerSourceList,
  catalog: CatalogPeak[]
): ResolvedListMember[] {
  validateSourceList(list, source);
  const catalogById = new Map(catalog.map((peak) => [peak.id, peak]));
  const rows = selectedSourceRows(list, source);
  const members: ResolvedListMember[] = [];
  const resolutionErrors: string[] = [];
  rows.forEach((row, index) => {
    try {
      const overrideId = list.destinationOverrides[row.peakbaggerPeakId];
      const destination = overrideId
        ? catalogById.get(overrideId)
        : resolveExactNameCandidate(row, catalog, list);
      if (!destination) {
        throw new Error(
          `List peak ${row.peakbaggerPeakId} ${row.name} has missing override ${overrideId}`
        );
      }
      members.push({
        destinationId: destination.id,
        ordinal: index,
        sourcePeakId: row.peakbaggerPeakId,
        sourceName: row.name,
      });
    } catch (error) {
      resolutionErrors.push(error instanceof Error ? error.message : String(error));
    }
  });
  if (resolutionErrors.length > 0) {
    throw new Error(resolutionErrors.join("; "));
  }
  const destinationIds = new Set(members.map((member) => member.destinationId));
  if (destinationIds.size !== members.length) {
    throw new Error(`Peakbagger list ${list.sourceListId} resolves two peaks to one destination`);
  }
  return members.sort((left, right) => left.ordinal - right.ordinal || left.sourcePeakId - right.sourcePeakId);
}

export function buildListPlan(
  list: CuratedList,
  members: ResolvedListMember[],
  current: CurrentListMember[]
): ListImportPlan {
  const desiredById = new Map(members.map((member) => [member.destinationId, member]));
  const currentForList = current.filter((member) => member.listId === list.listId);
  const currentById = new Map(currentForList.map((member) => [member.destinationId, member]));
  return {
    list,
    members,
    addedDestinationIds: members
      .filter((member) => !currentById.has(member.destinationId))
      .map((member) => member.destinationId),
    removedDestinationIds: currentForList
      .filter((member) => !desiredById.has(member.destinationId))
      .map((member) => member.destinationId),
    reorderedDestinationIds: members
      .filter((member) => {
        const existing = currentById.get(member.destinationId);
        return existing != null && existing.ordinal !== member.ordinal;
      })
      .map((member) => member.destinationId),
  };
}

/** One peak can appear on several lists. Keep one checked source ID per
 * destination, and fail if two reviewed list rows disagree. */
export function buildDestinationPeakbaggerIds(
  members: ResolvedListMember[],
  overrides: Record<string, string> = {}
): DestinationPeakbaggerId[] {
  const byDestination = new Map<string, string>();
  for (const member of members) {
    const peakbaggerId = overrides[member.destinationId] ?? String(member.sourcePeakId);
    const existing = byDestination.get(member.destinationId);
    if (existing && existing !== peakbaggerId) {
      throw new Error(
        `Destination ${member.destinationId} maps to Peakbagger peaks ${existing} and ${peakbaggerId}`
      );
    }
    byDestination.set(member.destinationId, peakbaggerId);
  }
  return [...byDestination.entries()]
    .map(([destinationId, peakbaggerId]) => ({ destinationId, peakbaggerId }))
    .sort((left, right) => left.destinationId.localeCompare(right.destinationId));
}

async function loadCatalog(client: PoolClient): Promise<CatalogPeak[]> {
  const result = await client.query<{
    id: string;
    name: string;
    elevation_m: string | number | null;
    lat: string | number;
    lng: string | number;
    osm_id: string | null;
    country_code: string | null;
    state_code: string | null;
  }>(
    `SELECT id, name, elevation AS elevation_m,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            external_ids->>'osm' AS osm_id,
            country_code,
            state_code
     FROM destinations
     WHERE location IS NOT NULL
       AND name IS NOT NULL
       AND 'summit'::destination_feature = ANY(features)`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    elevationM: row.elevation_m == null ? null : Number(row.elevation_m),
    lat: Number(row.lat),
    lng: Number(row.lng),
    osmId: row.osm_id,
    countryCode: row.country_code,
    stateCode: row.state_code,
  }));
}

async function loadCurrentMembers(client: PoolClient, listIds: string[]): Promise<CurrentListMember[]> {
  const result = await client.query<{
    list_id: string;
    destination_id: string;
    ordinal: number;
  }>(
    `SELECT list_id, destination_id, ordinal
     FROM list_destinations
     WHERE list_id = ANY($1::text[])`,
    [listIds]
  );
  return result.rows.map((row) => ({
    listId: row.list_id,
    destinationId: row.destination_id,
    ordinal: Number(row.ordinal),
  }));
}

function catalogWithCuratedDestinations(catalog: CatalogPeak[]): {
  catalog: CatalogPeak[];
  destinationsToAdd: CuratedDestination[];
} {
  const byOsmId = new Map(
    catalog.filter((peak) => peak.osmId).map((peak) => [peak.osmId as string, peak])
  );
  const byId = new Map(catalog.map((peak) => [peak.id, peak]));
  const destinationsToAdd: CuratedDestination[] = [];
  const additions: CatalogPeak[] = [];
  for (const destination of CURATED_DESTINATIONS) {
    const existingByOsm = byOsmId.get(destination.osmId);
    if (existingByOsm && existingByOsm.id !== destination.id) {
      throw new Error(
        `OSM node ${destination.osmId} already belongs to destination ${existingByOsm.id}`
      );
    }
    const existingById = byId.get(destination.id);
    if (existingById) {
      if (existingById.osmId !== destination.osmId) {
        throw new Error(`Curated destination ID ${destination.id} belongs to another source`);
      }
      continue;
    }
    const duplicate = catalog.find((peak) =>
      normalizeListPeakName(peak.name) === normalizeListPeakName(destination.name) &&
      haversineMeters(peak, destination) <= 150
    );
    if (duplicate) {
      throw new Error(
        `Curated destination ${destination.name} is within 150 m of ${duplicate.id}:${duplicate.name}`
      );
    }
    destinationsToAdd.push(destination);
    additions.push({
      id: destination.id,
      name: destination.name,
      elevationM: destination.elevationM,
      lat: destination.lat,
      lng: destination.lng,
      osmId: destination.osmId,
      countryCode: destination.countryCode,
      stateCode: destination.stateCode,
    });
  }
  return { catalog: [...catalog, ...additions], destinationsToAdd };
}

async function insertDestinations(
  client: PoolClient,
  destinations: CuratedDestination[]
): Promise<void> {
  if (destinations.length === 0) return;
  await client.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
         id text, name text, elevation_m double precision,
         lat double precision, lng double precision,
         country_code text, state_code text, osm_id text
       )
     )
     INSERT INTO destinations (
       id, name, search_name, elevation, location, type, activities, features,
       owner, country_code, state_code, external_ids, metadata
     )
     SELECT incoming.id,
            incoming.name,
            lower(incoming.name),
            incoming.elevation_m,
            ST_SetSRID(ST_MakePoint(incoming.lng, incoming.lat, incoming.elevation_m), 4326)::geography,
            'point',
            ARRAY['outdoor-trek']::activity_type[],
            ARRAY['summit']::destination_feature[],
            'peaks',
            incoming.country_code,
            incoming.state_code,
            jsonb_build_object('osm', incoming.osm_id),
            jsonb_build_object(
              'source', 'osm',
              'catalog_audit', 'peakbagger-lists-2026-08-18',
              'names', jsonb_build_object('display', incoming.name, 'osm_default', incoming.name)
            )
     FROM incoming
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      elevation_m: destination.elevationM,
      lat: destination.lat,
      lng: destination.lng,
      country_code: destination.countryCode,
      state_code: destination.stateCode,
      osm_id: destination.osmId,
    })))]
  );
}

async function applyPlans(
  client: PoolClient,
  plans: ListImportPlan[],
  destinationsToAdd: CuratedDestination[],
  peakbaggerIds: DestinationPeakbaggerId[]
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('peakbagger-list-import'))");
    await insertDestinations(client, destinationsToAdd);
    const conflicts = await client.query<{
      id: string;
      existing_id: string;
      incoming_id: string;
    }>(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
           destination_id text, peakbagger_id text
         )
       )
       SELECT d.id,
              d.external_ids->>'peakbagger' AS existing_id,
              incoming.peakbagger_id AS incoming_id
       FROM incoming
       JOIN destinations d ON d.id = incoming.destination_id
       WHERE d.external_ids ? 'peakbagger'
         AND d.external_ids->>'peakbagger' <> incoming.peakbagger_id`,
      [JSON.stringify(peakbaggerIds.map((value) => ({
        destination_id: value.destinationId,
        peakbagger_id: value.peakbaggerId,
      })))]
    );
    if (conflicts.rows.length > 0) {
      const conflict = conflicts.rows[0];
      throw new Error(
        `Destination ${conflict.id} already has Peakbagger ID ${conflict.existing_id}; ` +
        `reviewed lists resolve it to ${conflict.incoming_id}`
      );
    }
    await client.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
           destination_id text, peakbagger_id text
         )
       )
       UPDATE destinations d
          SET external_ids = COALESCE(d.external_ids, '{}'::jsonb) ||
                             jsonb_build_object('peakbagger', incoming.peakbagger_id),
              updated_at = now()
         FROM incoming
        WHERE d.id = incoming.destination_id
          AND d.external_ids->>'peakbagger' IS DISTINCT FROM incoming.peakbagger_id`,
      [JSON.stringify(peakbaggerIds.map((value) => ({
        destination_id: value.destinationId,
        peakbagger_id: value.peakbaggerId,
      })))]
    );
    for (const plan of plans) {
      const params = buildListUpsertParams(plan.list);
      await client.query(
        `INSERT INTO lists (
           id, name, description, owner,
           year_established, organization, source_name, source_url, region,
           completion_target
         )
         VALUES ($1, $2, $3, 'peaks', $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           owner = EXCLUDED.owner,
           year_established = EXCLUDED.year_established,
           organization = EXCLUDED.organization,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           region = EXCLUDED.region,
           completion_target = EXCLUDED.completion_target,
           updated_at = now()`,
        [
          params.listId,
          params.name,
          params.description,
          params.yearEstablished,
          params.organization,
          params.sourceName,
          params.sourceUrl,
          params.region,
          params.completionTarget,
        ]
      );
      const desiredIds = plan.members.map((member) => member.destinationId);
      await client.query(
        `DELETE FROM list_destinations
         WHERE list_id = $1
           AND NOT (destination_id = ANY($2::text[]))`,
        [plan.list.listId, desiredIds]
      );
      await client.query(
        `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
             list_id text, destination_id text, ordinal int
           )
         )
         INSERT INTO list_destinations (list_id, destination_id, ordinal)
         SELECT list_id, destination_id, ordinal FROM incoming
         ON CONFLICT (list_id, destination_id) DO UPDATE
           SET ordinal = EXCLUDED.ordinal`,
        [JSON.stringify(plan.members.map((member) => ({
          list_id: plan.list.listId,
          destination_id: member.destinationId,
          ordinal: member.ordinal,
        })))]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const audit = JSON.parse(await fs.readFile(args.input, "utf8")) as PeakbaggerAudit;
  const client = await db.connect();
  try {
    const liveCatalog = await loadCatalog(client);
    const { catalog, destinationsToAdd } = catalogWithCuratedDestinations(liveCatalog);
    const current = await loadCurrentMembers(client, CURATED_LISTS.map((list) => list.listId));
    const plans: ListImportPlan[] = [];
    const resolutionErrors: string[] = [];
    for (const list of CURATED_LISTS) {
      try {
        const source = audit[String(list.sourceListId)];
        const members = resolveListMembers(list, source, catalog);
        plans.push(buildListPlan(list, members, current));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolutionErrors.push(`${list.name}: ${message}`);
      }
    }
    if (resolutionErrors.length > 0) {
      throw new Error(`List import found ${resolutionErrors.length} resolution errors:\n` +
        resolutionErrors.join("\n"));
    }
    const peakbaggerIds = buildDestinationPeakbaggerIds(
      plans.flatMap((plan) => plan.members),
      DESTINATION_PEAKBAGGER_ID_OVERRIDES
    );

    if (args.apply) await applyPlans(client, plans, destinationsToAdd, peakbaggerIds);

    const nameById = new Map(catalog.map((peak) => [peak.id, peak.name]));
    console.log(JSON.stringify({
      apply: args.apply,
      source: "Peakbagger",
      destinationPeakbaggerIdCount: peakbaggerIds.length,
      destinationsToAdd: destinationsToAdd.map((destination) => ({
        id: destination.id,
        name: destination.name,
        osmId: destination.osmId,
      })),
      lists: plans.map((plan) => ({
        id: plan.list.listId,
        sourceListId: plan.list.sourceListId,
        name: plan.list.name,
        yearEstablished: plan.list.yearEstablished,
        organization: plan.list.organization,
        sourceName: plan.list.sourceName,
        sourceUrl: plan.list.sourceUrl,
        region: plan.list.region,
        completionTarget: buildListUpsertParams(plan.list).completionTarget,
        destinationCount: plan.members.length,
        added: plan.addedDestinationIds.map((id) => ({ id, name: nameById.get(id) })),
        removed: plan.removedDestinationIds.map((id) => ({ id, name: nameById.get(id) })),
        reorderedCount: plan.reorderedDestinationIds.length,
      })),
    }, null, 2));
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
