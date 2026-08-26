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
  /**
   * A list that takes only part of one Peakbagger page names the peaks it
   * takes. Set it with `sourceRowCount`, never alone: the selection says which
   * rows belong to the list, and the row count says the page they came from is
   * still the page that was reviewed. The Idaho 12ers are the case — Peakbagger
   * has no 12,000-foot list, only an 11,000-foot one.
   */
  sourcePeakIds?: number[];
  /** The row count the whole source page must still have. See `sourcePeakIds`. */
  sourceRowCount?: number;
  destinationOverrides: Record<number, string>;
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
  yearEstablished: number | null;
  organization: string | null;
  sourceName: string;
  sourceUrl: string;
  region: string;
}

export function buildListUpsertParams(list: CuratedList): ListUpsertParams {
  return {
    listId: list.listId,
    name: list.name,
    description: list.description,
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
  if ((selection == null) !== (list.sourceRowCount == null)) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} needs sourcePeakIds and sourceRowCount together`
    );
  }
  const expectedRows = selection == null ? list.expectedCount : list.sourceRowCount as number;
  if (source.rows.length !== expectedRows) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} has ${source.rows.length} rows; ` +
      `expected ${expectedRows}`
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
  if (selection == null) return;
  if (new Set(selection).size !== selection.length) {
    throw new Error(`Peakbagger list ${list.sourceListId} repeats selected peaks`);
  }
  if (selection.length !== list.expectedCount) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} selects ${selection.length} peaks; ` +
      `expected ${list.expectedCount}`
    );
  }
  const absent = selection.find((peakId) => !peakIds.has(peakId));
  if (absent != null) {
    throw new Error(`Peakbagger list ${list.sourceListId} is missing selected peak ${absent}`);
  }
}

function resolveExactNameCandidate(
  source: PeakbaggerSourcePeak,
  catalog: CatalogPeak[]
): CatalogPeak {
  const normalizedName = normalizeListPeakName(source.name);
  const sourceElevationM = source.elevationFt * METERS_PER_FOOT;
  let candidates = catalog.filter((peak) =>
    normalizeListPeakName(peak.name) === normalizedName &&
    peak.elevationM != null &&
    Math.abs(peak.elevationM - sourceElevationM) <= MAX_ELEVATION_DELTA_M
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
    const details = candidates.map((peak) => `${peak.id}:${peak.name}`).join(", ") || "none";
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
  const selection = list.sourcePeakIds == null ? null : new Set(list.sourcePeakIds);
  const rows = selection == null
    ? source.rows
    : source.rows.filter((row) => selection.has(row.peakbaggerPeakId));
  const members = rows.map((row, index) => {
    const overrideId = list.destinationOverrides[row.peakbaggerPeakId];
    const destination = overrideId
      ? catalogById.get(overrideId)
      : resolveExactNameCandidate(row, catalog);
    if (!destination) {
      throw new Error(
        `List peak ${row.peakbaggerPeakId} ${row.name} has missing override ${overrideId}`
      );
    }
    return {
      destinationId: destination.id,
      ordinal: index,
      sourcePeakId: row.peakbaggerPeakId,
      sourceName: row.name,
    };
  });
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
  }>(
    `SELECT id, name, elevation AS elevation_m,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            external_ids->>'osm' AS osm_id
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
           year_established, organization, source_name, source_url, region
         )
         VALUES ($1, $2, $3, 'peaks', $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           owner = EXCLUDED.owner,
           year_established = EXCLUDED.year_established,
           organization = EXCLUDED.organization,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           region = EXCLUDED.region,
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
    const plans = CURATED_LISTS.map((list) => {
      const source = audit[String(list.sourceListId)];
      const members = resolveListMembers(list, source, catalog);
      return buildListPlan(list, members, current);
    });
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
