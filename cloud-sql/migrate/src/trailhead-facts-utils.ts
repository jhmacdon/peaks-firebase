// Pure helpers for the trailhead-facts importer: name normalization, the
// two-gate match, per-source leaf extraction, conflict resolution, and the
// merge into destinations.amenities.
//
// Nothing here touches pg or fs, so every decision the importer makes can be
// unit-tested without a database — the same split as padus-area-utils.ts and
// import-padus-areas.ts.

// The bucket names, and nothing else, come from the calibration module. This
// file builds every leaf that reaches `destinations.amenities`, so it may check
// that a range is spelled the way the calibration spells it and may do nothing
// else with the calibration at all — it cannot compute a bucket from an area
// (`estimateCapacityRange`) and cannot compute a car count from one
// (`fittedCapacityCurve`). A test reads this import list and fails if either
// name appears in it.
import { CAPACITY_RANGES } from "./parking-capacity";
import type {
  SourcedValue,
  TrailheadAmenities,
  TrailheadBathrooms,
  TrailheadBathroomStatus,
  TrailheadBathroomType,
  TrailheadHighClearance,
  TrailheadParking,
  TrailheadParkingType,
  TrailheadRoadAccess,
} from "./lib/amenities";

/** Source names recorded in data_source_runs, one per input file. */
export type TrailheadFactSource =
  | "usfs_fees"
  | "usfs_bathrooms"
  | "usfs_pages"
  | "usfs_roads"
  | "nps_pois"
  | "nps_parking";

export const TRAILHEAD_FACT_SOURCES: readonly TrailheadFactSource[] = [
  "usfs_fees",
  "usfs_bathrooms",
  "usfs_pages",
  "usfs_roads",
  "nps_pois",
  "nps_parking",
];

/** Gate 1: a Peaks trailhead this far from the source point or nearer. */
export const TRAILHEAD_MATCH_RADIUS_M = 250;

// Gate 2 thresholds. pg_trgm similarity() and the JS token-overlap fallback
// score the same pair differently, so each measure carries its own cut:
//   - pg_trgm: character trigrams, so "eagle fork"/"eagle forks" still scores
//     ~0.8 and an unrelated pair sits well under 0.5.
//   - token overlap: Dice over whole tokens, which only moves in coarse steps
//     (two-token names share 0, 0.5 or 1), so 0.5 would let "baker lake" match
//     "baker creek". 0.7 forces more than half the tokens to agree.
export const PG_TRGM_NAME_THRESHOLD = 0.5;
export const TOKEN_OVERLAP_NAME_THRESHOLD = 0.7;

export const USFS_SOURCE_NAME = "US Forest Service";
export const USFS_LICENSE = "public domain (US federal government)";
export const EDW_SOURCE_KIND = "usfs_edw";
export const WEB_SOURCE_KIND = "usfs_web";

/**
 * The road layers, named as `roads:derive` names them on every leaf it emits.
 *
 * A leaf whose source kind is outside this list is not a road fact this
 * importer produced, so it is refused rather than copied: the kind is the only
 * thing standing between a hand-edited JSONL and `destinations.amenities`.
 */
export const ROAD_SOURCE_KINDS: readonly string[] = [
  "usfs_roadcore",
  "usfs_mvum",
  "blm_gtlf",
];

/**
 * The National Park Service layers, named as the normalizer names them.
 *
 * These two are the only kinds in this importer that carry a **derived** fact:
 * a restroom or a lot is attached to a trailhead because it is within 150 m of
 * it, with no name, no site id and no agency sentence tying the two together.
 * Everything else here is a fact an agency published about a named site. That
 * difference is what `preferCandidate` and `mergeTrailheadAmenities` act on
 * below — an explicit claim beats a spatial join on the same leaf, always.
 */
export const NPS_SOURCE_KINDS: readonly string[] = ["nps_pois", "nps_parking"];

export function isNpsSourceKind(kind: string | undefined): boolean {
  return typeof kind === "string" && NPS_SOURCE_KINDS.includes(kind);
}

/** Source kinds this importer owns and may overwrite on a re-run. */
export const MANAGED_SOURCE_KINDS: readonly string[] = [
  EDW_SOURCE_KIND,
  WEB_SOURCE_KIND,
  ...ROAD_SOURCE_KINDS,
  ...NPS_SOURCE_KINDS,
];

/** Service URL per EDW dataset, recorded as the source url on every fee leaf. */
export const DATASET_SERVICE_URLS: Record<string, string> = {
  usfs_rec_sites:
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0",
  usfs_recreation_opportunities:
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0",
};

// A restroom string that points somewhere other than the trailhead itself.
// Such a row still proves a restroom exists, but not that it is at the
// trailhead, so the raw text becomes bathrooms.location_note and the specific
// on-site type claim is dropped.
export const OFF_SITE_BATHROOM_PATTERN =
  /nearby|adjacent|down the road|at (the )?.*(picnic|campground|lake)/i;

const BATHROOM_TYPES: readonly TrailheadBathroomType[] = [
  "vault_pit",
  "flush",
  "portable",
  "composting",
  "unspecified",
];

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * Lowercase, drop punctuation, collapse whitespace, and strip a trailing
 * "trailhead" / "trail head" / "th" so "GREYS LAKE TRAILHEAD" and
 * "Greys Lake TH" normalize to the same string.
 */
export function normalizeTrailheadName(raw: string | null | undefined): string {
  const lowered = (raw ?? "").toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const stripped = cleaned.replace(/\s+(trailhead|trail head|th)$/, "").trim();
  // "Trailhead" on its own is a name, not a suffix — keep something to match on.
  return stripped.length > 0 ? stripped : cleaned;
}

export function nameTokens(normalized: string): string[] {
  return normalized.split(" ").filter((token) => token.length > 0);
}

/**
 * Dice coefficient over token sets — the fallback name measure when the
 * database has no pg_trgm. 1 means the same token set, 0 means no shared token.
 */
/**
 * The shorter name needs at least this many tokens before containment can pass
 * it. One token is not evidence: "Butte" sits inside "Driveway Butte" without
 * being the same trailhead.
 */
export const CONTAINMENT_MIN_TOKENS = 2;

/**
 * The second half of the name gate, beside the similarity threshold: every
 * token of the shorter normalized name appears in the longer one.
 *
 * Nearly every good match the threshold loses fails for one reason — Peaks
 * appends a qualifier the agency does not ("Parking", "Picnic Area", "Day
 * Use"), and trigram similarity punishes the length difference. "Windy Peak
 * Trailhead/Long Swamp" against "Windy Peak Trailhead" scores 0.344 at 0.0 m.
 * Measured over the 175 near-misses from the production dry run, this recovers
 * 40 rows across 28 pairs with no wrong match, and still rejects the pairs that
 * merely share a word (Willow Lake / Willow Creek, Ape Canyon / Lava Canyon).
 *
 * Both arguments must already be normalized.
 */
export function nameTokensContained(a: string, b: string): boolean {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  const [shorter, longer] = left.size <= right.size ? [left, right] : [right, left];
  if (shorter.size < CONTAINMENT_MIN_TOKENS) return false;
  for (const token of shorter) {
    if (!longer.has(token)) return false;
  }
  return true;
}

export function tokenOverlapSimilarity(a: string, b: string): number {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return (2 * shared) / (left.size + right.size);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * How a source row reached its destination. The two name-gate rules are for
 * the sources matched by place and name; `exact_id` is the road rows, which
 * were derived from the destination table itself and carry its id.
 */
export type NameRule = "threshold" | "containment" | "exact_id";

export interface MatchCandidate {
  destinationId: string;
  destinationName: string;
  distanceM: number;
  similarity: number;
  /** Which of the row's names produced that similarity. */
  matchedName: string;
  /** True when one of the row's names is a token subset of this destination's. */
  contained: boolean;
  /** Which name satisfied containment, when one did. */
  containedName?: string;
}

export type MatchOutcome =
  | { kind: "matched"; candidate: MatchCandidate; rule: NameRule }
  | { kind: "name_below_threshold"; best: MatchCandidate }
  | { kind: "no_nearby_trailhead" };

function betterCandidate(current: MatchCandidate, next: MatchCandidate): MatchCandidate {
  if (next.similarity > current.similarity) return next;
  if (next.similarity === current.similarity && next.distanceM < current.distanceM) return next;
  return current;
}

/**
 * Gate 2. Candidates have already passed gate 1 (a trailhead-featured
 * destination within the radius). A candidate passes on either rule — the
 * similarity threshold or token containment — and among those that pass, the
 * best similarity wins with the nearer point breaking a tie. When none pass,
 * the best-scoring candidate is reported so the rejection can be audited.
 */
export function chooseMatch(candidates: MatchCandidate[], threshold: number): MatchOutcome {
  if (candidates.length === 0) return { kind: "no_nearby_trailhead" };

  let best = candidates[0];
  let passing: MatchCandidate | null = null;
  for (const candidate of candidates) {
    best = betterCandidate(best, candidate);
    if (candidate.similarity >= threshold || candidate.contained) {
      passing = passing === null ? candidate : betterCandidate(passing, candidate);
    }
  }

  if (passing === null) return { kind: "name_below_threshold", best };
  const rule: NameRule = passing.similarity >= threshold ? "threshold" : "containment";
  // Containment matched on its own name, which may not be the one that scored
  // best; report the name that actually carried the match.
  const candidate =
    rule === "containment" && passing.containedName
      ? { ...passing, matchedName: passing.containedName }
      : passing;
  return { kind: "matched", candidate, rule };
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export interface SourcePoint {
  lat: number;
  lng: number;
}

/** Metres between two points, good enough at trailhead scale. */
export function distanceMeters(a: SourcePoint, b: SourcePoint): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return R * Math.hypot(x, y);
}

/**
 * A usable point, or null.
 *
 * The range check is not decoration. `ST_MakePoint` accepts a latitude of 200
 * and a geography cast turns it into some point on the globe, so a coordinate
 * the extraction got wrong would come back as a confident distance to a real
 * trailhead rather than as an error.
 */
export function usableSourcePoint(lat: unknown, lng: unknown): SourcePoint | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Source rows
// ---------------------------------------------------------------------------

export interface FeeRow {
  source_dataset: string;
  source_id: string;
  name: string;
  lat: number;
  lng: number;
  fee_required: boolean | null;
  day_fee_usd: number | null;
  annual_fee_usd: number | null;
  passes_accepted: string[] | null;
  fee_waived_for: string[] | null;
  confidence?: string | null;
  verbatim_quote?: string | null;
  as_of: string;
}

export interface BathroomRow {
  source_dataset: string;
  source_id: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
  type: string | null;
  season_note: string | null;
  raw_string: string | null;
  verbatim_quote?: string | null;
  as_of: string;
}

/**
 * One row of `fs-page-sections-full.jsonl`: a Forest Service site page, the
 * coordinates the page itself publishes, and the facts extracted from its
 * prose. Absent fields are omitted rather than written as null.
 *
 * **The page carries its own point.** An earlier version of this pipeline had
 * no coordinates on a page and borrowed them from the same-named EDW
 * trailhead; a cross-check of that mechanism found every one of its 98
 * far-outlier borrows to be a wrong attach. So a page row now goes through the
 * same two gates as the fee and bathroom rows — 250 m and a name — and a page
 * with no coordinates is counted rather than located by inference.
 *
 * Four fields are declared and none is imported, so that their absence from
 * `pageLeafCandidates` is visible rather than accidental. `fee_text`,
 * `restroom_text` and `road_text` are prose about facts the EDW, MVUM and
 * RoadCore datasets already publish as fields; corroborating one against the
 * other is its own piece of work. `verbatim_spans` is the evidence a person
 * auditing the extraction reads, and `elevation_ft` belongs to the
 * destination, not to its amenities.
 *
 * **Two of them are read as guards, and a guard may only take away.**
 * `verbatim_spans.capacity` is the page's own words behind its number, and
 * `road_text` is its driving directions; between them they drop a capacity
 * counted in trailers, lower one stated as a range to its floor, and refuse a
 * "fills early" note that turns out to be a sentence of directions. Neither
 * ever supplies a fact — the same rule the road importer's single read of its
 * `derivation` block obeys.
 */
export interface PageSectionRow {
  url: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  capacity_estimate?: number | null;
  fills_early_note?: string | null;
  fee_text?: string | null;
  restroom_text?: string | null;
  road_text?: string | null;
  elevation_ft?: number | null;
  verbatim_spans?: unknown;
  fetched_at: string;
}

/**
 * A row of the raw EDW recreation-site pull. The normalized fee and bathroom
 * files drop two fields the importer needs: fee_charged contradicts a
 * normalized no-fee claim, and public_site_name is the name the public (and
 * Peaks) catalogs a trailhead under.
 */
export interface RawRecSiteRow {
  site_cn?: string | number | null;
  site_name?: string | null;
  public_site_name?: string | null;
  fee_charged?: string | null;
  fee_type?: string | null;
}

export interface RecSiteFacts {
  sourceId: string;
  feeCharged: string | null;
  feeType: string | null;
  publicName: string | null;
}

export type RecSiteIndex = Map<string, RecSiteFacts>;

/** The only dataset the raw pull covers. */
export const REC_SITE_DATASET = "usfs_rec_sites";

/**
 * Index key. Source ids are only unique within a dataset, so a
 * recreation-opportunity row must never inherit the facts of a recreation site
 * that happens to share its id.
 */
export function recSiteKey(sourceDataset: string, sourceId: string | number): string {
  return `${sourceDataset}:${sourceId}`;
}

/** Index the raw pull by site_cn, which is the source_id of the normalized rows. */
export function buildRecSiteIndex(rows: RawRecSiteRow[]): RecSiteIndex {
  const index: RecSiteIndex = new Map();
  for (const row of rows) {
    const sourceId = row.site_cn === null || row.site_cn === undefined ? "" : String(row.site_cn).trim();
    if (sourceId.length === 0) continue;
    index.set(recSiteKey(REC_SITE_DATASET, sourceId), {
      sourceId,
      feeCharged: row.fee_charged ? String(row.fee_charged).trim().toUpperCase() : null,
      feeType: row.fee_type ? String(row.fee_type).trim() : null,
      publicName: row.public_site_name ? String(row.public_site_name).trim() : null,
    });
  }
  return index;
}

/**
 * Every name worth putting through the name gate: the normalized row's own
 * name plus the EDW public site name, which differs on most rows and is the
 * name Peaks catalogs trailheads under.
 */
export function candidateNames(name: string, facts: RecSiteFacts | null | undefined): string[] {
  const names = [name, facts?.publicName ?? null].filter((value): value is string => {
    return typeof value === "string" && value.trim().length > 0;
  });
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of names) {
    const key = normalizeTrailheadName(value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Leaf candidates
// ---------------------------------------------------------------------------

export type ParkingLeaf = keyof TrailheadParking;
export type BathroomLeaf = keyof TrailheadBathrooms;
export type RoadAccessLeaf = keyof TrailheadRoadAccess;

export interface LeafCandidate {
  block: "parking" | "bathrooms" | "road_access";
  leaf: ParkingLeaf | BathroomLeaf | RoadAccessLeaf;
  source: TrailheadFactSource;
  /** Identifies the input row, for the run counts and the report files. */
  rowKey: string;
  sourced: SourcedValue<unknown>;
}

export function leafKey(candidate: Pick<LeafCandidate, "block" | "leaf">): string {
  return `${candidate.block}.${candidate.leaf}`;
}

function edwSourced(row: { source_dataset: string; source_id: string; as_of: string }, value: unknown): SourcedValue<unknown> {
  const url = DATASET_SERVICE_URLS[row.source_dataset];
  return {
    value,
    source: {
      kind: EDW_SOURCE_KIND,
      name: USFS_SOURCE_NAME,
      ...(url ? { url } : {}),
      license: USFS_LICENSE,
      external_id: row.source_id,
    },
    retrieved_at: row.as_of,
  };
}

function webSourced(url: string, retrievedAt: string, value: unknown): SourcedValue<unknown> {
  return {
    value,
    source: {
      kind: WEB_SOURCE_KIND,
      name: USFS_SOURCE_NAME,
      url,
      license: USFS_LICENSE,
    },
    retrieved_at: retrievedAt,
  };
}

/**
 * The day part of a timestamp, when it is a real day.
 *
 * The page rows carry a full instant ("2026-08-20T14:02:11+00:00") and every
 * other source in this importer stamps a `YYYY-MM-DD` on its leaves, which is
 * also the only shape the clients parse. The time of day says nothing about a
 * parking lot, so it goes; a value whose day part is not a real calendar day is
 * refused rather than trimmed into something that looks like one.
 */
export function isoDatePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.trim().slice(0, 10);
  return parseIsoDate(day) === null ? null : day;
}

function nonEmptyText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A count of things, which is what a capacity is.
 *
 * Stricter than `positiveNumber` in two ways, and the fees keep the looser one
 * because a fee of $0.00 and a fee of $5.50 are both real.
 *
 * **Zero is refused.** `capacity_vehicles: 0` renders as "0 vehicles", which
 * reads as "there is no parking here" — a claim no page in this set makes and
 * one an extraction bug could produce from a sentence it did not understand.
 * Silence is the honest form of not knowing.
 *
 * **A fraction is refused.** Half a parking space is an extraction that has
 * gone wrong, not a lot with a half space in it.
 */
function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * Words that mean the page counted something bigger than a car.
 *
 * "Up to 6 truck/trailer combinations" is a real capacity and it is not six
 * cars — an ORV or stock trailhead rates its lot in rigs, and each rig is two
 * or three car spaces. Writing 6 into `capacity_vehicles` understates the lot
 * for a driver in a car and overstates it for one towing. Two matched rows say
 * this today (Edds Mountain 6, Bear Pot 4) and three more wait one catalog
 * addition away.
 *
 * There is no leaf for "6 rigs", so the count is dropped rather than converted:
 * the multiplier is a guess, and a guessed number is the thing this importer
 * spends most of its rules avoiding.
 */
export const TRAILER_CAPACITY_PATTERN =
  /\b(truck|trucks|trailer|trailers|rv|rvs|motorhome|motorhomes|semi|stock|horse|horses)\b/i;

/** The page's own words behind its capacity, when the extraction kept them. */
export function capacitySpanText(spans: unknown): string | null {
  if (!isPlainObject(spans)) return null;
  const capacity = spans.capacity;
  return typeof capacity === "string" && capacity.trim().length > 0 ? capacity.trim() : null;
}

/**
 * The low end of a range the page states, when it states one.
 *
 * "Parking for 10-15 cars" is two numbers and the extraction keeps the high
 * one. **The low end is the one to publish.** A driver who arrives to find ten
 * spaces where fifteen were promised has been sent up a forest road for
 * nothing; the other error costs them a pleasant surprise.
 */
export function rangeLowEnd(span: string | null): number | null {
  if (span === null) return null;
  const match = /(\d+)\s*(?:-|–|—|\bto\b)\s*(\d+)/.exec(span);
  if (match === null) return null;
  const low = Math.min(Number(match[1]), Number(match[2]));
  return Number.isInteger(low) && low >= 1 ? low : null;
}

/**
 * Words that make a sentence a fact about the lot filling rather than prose
 * about how to drive there.
 *
 * The substring guard below asks whether a `fills_early_note` was lifted out of
 * the driving directions. Sitting inside that paragraph is good evidence and
 * not proof: a page that writes its one sentence about the lot filling in the
 * middle of the directions has still written it. Measured over the whole
 * extraction, the guard fires on 51 rows and exactly two of them say any of
 * these words — Dog Mountain's "There are about 70 spots fill quickly on
 * weekends" and Max Patch's "You may not park on the road if the parking lot is
 * full". Both are real; the other 49 are directions or a sentence about how
 * much room there is, and none of them is readmitted.
 *
 * Word boundaries are load-bearing: a bare `/full/` also matches "carefully",
 * which is exactly the kind of word a directions paragraph is full of.
 */
export const FILLS_EARLY_SUBSTANCE_PATTERN =
  /\b(fill|fills|filled|filling|full|crowd|crowds|crowded|overflow|overflows|overflowing)\b/i;

/** Whitespace and case flattened, so two spellings of one sentence compare equal. */
function flattenText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => String(item).trim()).filter((item) => item.length > 0);
  return items.length > 0 ? items : null;
}

export interface LeafExtraction {
  leaves: LeafCandidate[];
  /** Facts deliberately not written, keyed by a short reason. */
  refusals: string[];
  /** Facts written with a caveat worth counting — a weaker guard, say. */
  notices: string[];
}

/**
 * Fee row → parking leaves.
 *
 * Two guards on a no-fee claim, because telling someone a fee site is free is
 * the worst thing this importer could do:
 *
 * 1. Never write fee_required=false without a verbatim quote.
 * 2. Never write it when the raw EDW row says fee_charged='Y'. The quote guard
 *    alone is vacuous — 2,551 of the 3,254 false rows quote the boilerplate
 *    "No fees are required for this site" that ships as the EDW default — and
 *    66 of those rows sit on records the same dataset marks as charging, 22 of
 *    them with an explicit STANDARD AMENITY FEE. The stricter claim wins.
 *
 * `facts` is required, not optional, so a future caller cannot quietly drop
 * back to guard 1 alone. Pass null when the row has no raw counterpart — the
 * recreation-opportunities dataset has none — and the no-fee claim it writes
 * rests on its quote alone, counted as fee_required_false_quote_only.
 */
export function feeLeafCandidates(row: FeeRow, facts: RecSiteFacts | null): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const notices: string[] = [];
  const rowKey = recSiteKey(row.source_dataset, row.source_id);
  const push = (leaf: ParkingLeaf, value: unknown) => {
    leaves.push({ block: "parking", leaf, source: "usfs_fees", rowKey, sourced: edwSourced(row, value) });
  };

  if (row.fee_required === true) {
    push("fee_required", true);
  } else if (row.fee_required === false) {
    if (facts?.feeCharged === "Y") {
      refusals.push("fee_required_false_contradicted_by_fee_charged");
    } else if (nonEmptyText(row.verbatim_quote)) {
      push("fee_required", false);
      if (facts?.feeCharged !== "N") notices.push("fee_required_false_quote_only");
    } else {
      refusals.push("fee_required_false_without_quote");
    }
  }

  const dayFee = positiveNumber(row.day_fee_usd);
  if (dayFee !== null) push("day_fee_usd", dayFee);

  const annualFee = positiveNumber(row.annual_fee_usd);
  if (annualFee !== null) push("annual_fee_usd", annualFee);

  const passes = stringList(row.passes_accepted);
  if (passes) push("passes_accepted", passes);

  const waived = stringList(row.fee_waived_for);
  if (waived) push("fee_waived_for", waived);

  return { leaves, refusals, notices };
}

export function isOffSiteBathroomNote(rawString: string | null | undefined): boolean {
  const text = nonEmptyText(rawString);
  return text !== null && OFF_SITE_BATHROOM_PATTERN.test(text);
}

/**
 * Bathroom row → bathrooms leaves. Only present/absent rows carry a fact;
 * "unknown" means the source said nothing, which stays an absent leaf.
 */
export function bathroomLeafCandidates(row: BathroomRow): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const rowKey = recSiteKey(row.source_dataset, row.source_id);
  if (row.status !== "present" && row.status !== "absent") {
    refusals.push("status_unknown");
    return { leaves, refusals, notices: [] };
  }
  const status = row.status as TrailheadBathroomStatus;
  const push = (leaf: BathroomLeaf, value: unknown) => {
    leaves.push({ block: "bathrooms", leaf, source: "usfs_bathrooms", rowKey, sourced: edwSourced(row, value) });
  };

  push("status", status);

  const offSite = isOffSiteBathroomNote(row.raw_string);
  if (offSite) {
    push("location_note", nonEmptyText(row.raw_string) as string);
    // The restroom is somewhere else, so the row's on-site type claim goes.
    // An "absent" row has no on-site restroom to type at all.
    if (status === "present") push("type", "unspecified");
  } else if (row.type && BATHROOM_TYPES.includes(row.type as TrailheadBathroomType)) {
    if (status === "present") push("type", row.type as TrailheadBathroomType);
    else refusals.push("type_on_absent_row");
  }

  const seasonNote = nonEmptyText(row.season_note);
  if (seasonNote) push("season_note", seasonNote);

  return { leaves, refusals, notices: [] };
}

/**
 * Page section row → parking leaves: the capacity the page states and the
 * sentence it writes about the lot filling.
 *
 * Two leaves out of a row that holds far more, and the restraint is the point.
 * The page's fee, restroom and road prose describes facts three agency
 * datasets already publish as fields, and its verbatim spans are the
 * extraction's evidence rather than a fact about the trailhead. Only the two
 * things no dataset carries are imported.
 *
 * **Three guards, and every one of them can only take a claim away or make it
 * smaller.** They read `verbatim_spans` and `road_text`, which are otherwise
 * unimported, in the same spirit as the road importer's one read of its audit
 * block: evidence is allowed to withhold a fact, never to supply one.
 *
 * 1. A capacity whose own words say truck, trailer, RV or stock is dropped.
 *    The page counted rigs, and there is no leaf for rigs.
 * 2. A capacity whose words state a range is published at the range's low end.
 *    The extraction keeps the high end; over-claiming parking is what strands
 *    a driver.
 * 3. A `fills_early_note` that appears word for word inside the page's driving
 *    directions is dropped, **unless the sentence itself says something about
 *    filling, being full, crowds or overflow**. The extraction found no
 *    sentence about the lot filling and lifted one out of the paragraph about
 *    how to get there — "Turn right onto Road 225 and continue approximately 4
 *    miles to the small trailhead parking area" is not a fact about when the
 *    lot fills. But a page that writes its one real such sentence inside the
 *    directions has still written it, and dropping that is the guard costing a
 *    fact rather than saving one. See `FILLS_EARLY_SUBSTANCE_PATTERN`.
 */
export function pageLeafCandidates(row: PageSectionRow): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const notices: string[] = [];

  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (!/^https?:\/\/\S/i.test(url)) {
    refusals.push("page_url_unusable");
    return { leaves, refusals, notices: [] };
  }
  const retrievedAt = isoDatePart(row.fetched_at);
  if (retrievedAt === null) {
    refusals.push("fetched_at_not_iso");
    return { leaves, refusals, notices: [] };
  }

  const push = (leaf: ParkingLeaf, value: unknown) => {
    leaves.push({
      block: "parking",
      leaf,
      source: "usfs_pages",
      rowKey: url,
      sourced: webSourced(url, retrievedAt, value),
    });
  };

  const span = capacitySpanText(row.verbatim_spans);
  const stated = positiveInteger(row.capacity_estimate);
  if (row.capacity_estimate !== null && row.capacity_estimate !== undefined && stated === null) {
    refusals.push("capacity_not_a_positive_whole_number");
  } else if (stated !== null) {
    if (span !== null && TRAILER_CAPACITY_PATTERN.test(span)) {
      refusals.push("capacity_counted_in_trucks_or_trailers");
    } else {
      const low = rangeLowEnd(span);
      const capacity = low !== null && low < stated ? low : stated;
      if (capacity !== stated) notices.push("capacity_lowered_to_stated_range_floor");
      push("capacity_vehicles", capacity);
    }
  }

  const fillsEarly = nonEmptyText(row.fills_early_note);
  if (fillsEarly) {
    const directions = typeof row.road_text === "string" ? flattenText(row.road_text) : "";
    const lifted = directions.length > 0 && directions.includes(flattenText(fillsEarly));
    if (lifted && !FILLS_EARLY_SUBSTANCE_PATTERN.test(fillsEarly)) {
      refusals.push("fills_early_note_lifted_from_directions");
    } else {
      push("fills_early_note", fillsEarly);
    }
  }

  if (leaves.length === 0 && refusals.length === 0) refusals.push("no_structured_facts");
  return { leaves, refusals, notices };
}

// ---------------------------------------------------------------------------
// Access-road facts
// ---------------------------------------------------------------------------

/**
 * One row of `trailhead-road-access.jsonl`, as it arrives: unvalidated.
 *
 * `roads:derive` shapes every leaf like `SourcedValue` already, so the import
 * is a copy rather than a translation — but the file is a file, so nothing
 * here is trusted until it is checked. Only the five published leaves are
 * declared. **`derivation` is read for exactly one thing, the gate below, and
 * never written**: it holds `path_miles`, which is far longer than the drive
 * wherever the way out of the forest is a state highway these sources do not
 * carry.
 */
export interface RoadAccessRow {
  destination_id?: unknown;
  destination_name?: unknown;
  skip_reason?: unknown;
  surface?: unknown;
  high_clearance?: unknown;
  four_wheel_drive?: unknown;
  seasonal_window?: unknown;
  limiting_segment_ref?: unknown;
  derivation?: unknown;
}

const HIGH_CLEARANCE_VALUES: readonly TrailheadHighClearance[] = [
  "required",
  "recommended",
  "not_required",
];

/** A window may not sit further than this many years from the import run. */
export const ROAD_SEASON_YEAR_TOLERANCE = 1;

/**
 * A real calendar day written the one way the clients read first.
 *
 * Strict on purpose: no trimming, no `MM/DD` fallback, no February 30. The
 * derivation writes `YYYY-MM-DD` and the iOS formatter parses ISO before it
 * tries anything else, so a date in any other shape here means something
 * upstream changed and the honest response is to drop the leaf and count it.
 */
export function parseIsoDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Rebuild one leaf's envelope from the file, field by field.
 *
 * Nothing is spread: the value, the source kind, name, url and licence, and
 * the retrieval date are copied by name and everything else in the file's
 * object is left there. A JSONL row is not a schema, and
 * `destinations.amenities` is unvalidated JSONB — whatever this function
 * returns is what lands in it.
 *
 * The url is kept only when it is an http(s) link. The clients render a source
 * url as something tappable, and a `javascript:` string arriving from a data
 * file has no business becoming one.
 */
export function fileSourcedValue(
  raw: unknown,
  value: unknown,
  allowedKinds: readonly string[]
): SourcedValue<unknown> | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.source)) return null;
  const { kind, name, url, license } = raw.source;
  if (typeof kind !== "string" || !allowedKinds.includes(kind)) return null;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  if (parseIsoDate(raw.retrieved_at) === null) return null;
  const link = typeof url === "string" && /^https?:\/\/\S/i.test(url.trim()) ? url.trim() : null;
  const terms = typeof license === "string" && license.trim().length > 0 ? license.trim() : null;
  return {
    value,
    source: {
      kind,
      name: name.trim(),
      ...(link ? { url: link } : {}),
      ...(terms ? { license: terms } : {}),
    },
    retrieved_at: raw.retrieved_at as string,
  };
}

function roadSourcedValue(raw: unknown, value: unknown): SourcedValue<unknown> | null {
  return fileSourcedValue(raw, value, ROAD_SOURCE_KINDS);
}

/**
 * Road access row → road_access leaves, with every binding rule applied.
 *
 * Four refusals, and each one exists because publishing the fact would be
 * worse than publishing nothing:
 *
 * 1. **Any `skip_reason` skips the whole row.** The derivation only sets one
 *    when it could not answer honestly — no road within the snap radius, no
 *    maintained road reachable, an unrated edge on the path, or a route no
 *    highway vehicle belongs on. A partial answer from such a row reads as a
 *    complete one.
 * 2. **A window resting on a segment MVUM never described is refused.**
 *    `buildApproachRow` already withholds it, so a window arriving with a gap
 *    means that gate regressed; this counts it loudly rather than letting the
 *    claim through on the strength of a road nobody checked.
 * 3. **A date that is not ISO is refused**, never reformatted or guessed at.
 * 4. **A window anchored years away from the run is refused.** The year is a
 *    carrier for a window that recurs every season, but a window intersected
 *    through February 29 is anchored to the next leap year, which can land two
 *    years out — a date nobody should be reading off a detail sheet.
 */
export function roadAccessLeafCandidates(row: RoadAccessRow, runYear: number): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const rowKey = typeof row.destination_id === "string" ? row.destination_id : "";

  const skipReason = typeof row.skip_reason === "string" ? row.skip_reason.trim() : "";
  if (skipReason.length > 0) {
    refusals.push(`skipped_${skipReason}`);
    return { leaves, refusals, notices: [] };
  }

  const push = (leaf: RoadAccessLeaf, sourced: SourcedValue<unknown> | null, reason: string) => {
    if (sourced === null) refusals.push(reason);
    else leaves.push({ block: "road_access", leaf, source: "usfs_roads", rowKey, sourced });
  };

  if (row.surface !== undefined) {
    const value = isPlainObject(row.surface) ? row.surface.value : undefined;
    const word = typeof value === "string" ? value.trim() : "";
    push(
      "surface",
      word.length === 0 ? null : roadSourcedValue(row.surface, word),
      "surface_unusable",
    );
  }

  if (row.high_clearance !== undefined) {
    const value = isPlainObject(row.high_clearance) ? row.high_clearance.value : undefined;
    const known = HIGH_CLEARANCE_VALUES.includes(value as TrailheadHighClearance);
    push(
      "high_clearance",
      known ? roadSourcedValue(row.high_clearance, value) : null,
      "high_clearance_unusable",
    );
  }

  if (row.four_wheel_drive !== undefined) {
    const value = isPlainObject(row.four_wheel_drive) ? row.four_wheel_drive.value : undefined;
    push(
      "four_wheel_drive",
      typeof value === "boolean" ? roadSourcedValue(row.four_wheel_drive, value) : null,
      "four_wheel_drive_unusable",
    );
  }

  if (row.limiting_segment_ref !== undefined) {
    const value = isPlainObject(row.limiting_segment_ref)
      ? row.limiting_segment_ref.value
      : undefined;
    const ref = typeof value === "string" ? value.trim() : "";
    push(
      "limiting_segment_ref",
      ref.length === 0 ? null : roadSourcedValue(row.limiting_segment_ref, ref),
      "limiting_segment_ref_unusable",
    );
  }

  if (row.seasonal_window !== undefined) {
    // The one read of the audit block, and it can only ever withhold a leaf.
    const derivation = isPlainObject(row.derivation) ? row.derivation : {};
    const gaps = derivation.season_segments_without_evidence;
    const value = isPlainObject(row.seasonal_window) ? row.seasonal_window.value : undefined;
    const opens = isPlainObject(value) ? value.opens : undefined;
    const closes = isPlainObject(value) ? value.closes : undefined;
    const openDay = parseIsoDate(opens);
    const closeDay = parseIsoDate(closes);
    const inRange = (year: number): boolean =>
      Math.abs(year - runYear) <= ROAD_SEASON_YEAR_TOLERANCE;

    if (typeof gaps !== "number" || !Number.isFinite(gaps) || gaps > 0) {
      refusals.push("seasonal_window_evidence_gap");
    } else if (openDay === null || closeDay === null) {
      refusals.push("seasonal_window_not_iso");
    } else if (!inRange(openDay.year) || !inRange(closeDay.year)) {
      refusals.push("seasonal_window_out_of_range");
    } else {
      push(
        "seasonal_window",
        roadSourcedValue(row.seasonal_window, { opens, closes }),
        "seasonal_window_unusable",
      );
    }
  }

  if (leaves.length === 0 && refusals.length === 0) refusals.push("no_road_facts");
  return { leaves, refusals, notices: [] };
}

// ---------------------------------------------------------------------------
// National Park Service facts
// ---------------------------------------------------------------------------

/**
 * One row of `nps-trailhead-facts.jsonl`, as it arrives: unvalidated.
 *
 * `normalize:nps-trailhead-facts` shapes both blocks the way `amenities`
 * stores them, so the import is a copy — but the file is a file, and
 * `destinations.amenities` is unvalidated JSONB, so nothing is trusted until
 * it is checked. `diagnostics` is declared so its absence from everything
 * below is visible: it holds the join distance, the POI id and the lot name,
 * it is there for a person auditing a match, and **it is never imported.**
 */
export interface NpsFactRow {
  destination_id?: unknown;
  destination_name?: unknown;
  bathrooms?: unknown;
  parking?: unknown;
  diagnostics?: unknown;
}

/**
 * The only bathroom leaves an NPS row may carry.
 *
 * An allow-list rather than a filter, because the failure it guards against is
 * a leaf nobody reviewed arriving in a data file and landing in production
 * JSONB unread. A key outside this list is refused and counted by name.
 */
export const NPS_BATHROOM_LEAVES: readonly BathroomLeaf[] = ["status", "type", "season_note"];

/**
 * The only parking leaves an NPS row may carry — and the reason the list reads
 * the way it does.
 *
 * NPS publishes 6,740 lot polygons and **no capacity field at all**, so what
 * this source can say about how much parking there is comes from the lot's own
 * mapped area, through the calibration in `parking-capacity.ts`. That yields a
 * bucket, and the bucket goes in `capacity_range`.
 *
 * **`capacity_vehicles` is not merely absent from this list: a row carrying one
 * is refused and counted by name.** A count is a claim somebody made by
 * counting; a range is a claim a curve made by measuring ground. The only way a
 * number could appear on an NPS parking leaf is a regression that started
 * turning area into vehicles, and it would read exactly like a number somebody
 * counted.
 */
export const NPS_PARKING_LEAVES: readonly ParkingLeaf[] = [
  "type",
  "capacity_range",
  "location_note",
];

const PARKING_TYPES: readonly TrailheadParkingType[] = ["lot", "roadside", "garage", "other"];

function nonEmptyStringValue(leaf: unknown): string | null {
  const value = isPlainObject(leaf) ? leaf.value : undefined;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function npsRowKey(row: NpsFactRow): string {
  return typeof row.destination_id === "string" ? row.destination_id : "";
}

/**
 * NPS row → bathroom leaves, with every binding rule applied.
 *
 * The rule that outranks the rest: **`status` may only ever be `present`.**
 * NPS records the restrooms it has mapped and says nothing about the ones it
 * has not (research-bathrooms.md §3.2), so a trailhead with no toilet POI near
 * it is a trailhead nobody surveyed, not a trailhead without a toilet. The
 * normalizer cannot write `absent` — and this refuses it again here, the whole
 * block with it, because a rule enforced in only one of two places is a rule
 * the next writer of the other place does not know about. A block carrying a
 * type but no status is refused by the same line: a type alone says "present"
 * without saying it.
 *
 * The rest follow the road importer's shape:
 *
 * - Leaves must carry this service's own source kind, `nps_pois`, so a
 *   hand-edited file cannot move a leaf between services.
 * - Every envelope is rebuilt field by field rather than copied.
 * - A leaf outside `NPS_BATHROOM_LEAVES` is refused and counted by name.
 * - `diagnostics` is not read. The distance a match rested on is evidence for
 *   a person, not a fact about a trailhead.
 *
 * **The status leaf is settled first, envelope and all, before any other leaf
 * is looked at.** It is the leaf the whole block rests on, so a status whose
 * provenance does not check out has to take the block with it: a `type:
 * vault_pit` surviving on its own would tell a reader a restroom is there
 * without the leaf that says so, which is the presence claim made by
 * implication instead of by evidence.
 */
export function npsBathroomLeafCandidates(row: NpsFactRow): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const rowKey = npsRowKey(row);
  if (row.bathrooms === undefined) return { leaves, refusals, notices: [] };

  const block = isPlainObject(row.bathrooms) ? row.bathrooms : null;
  if (block === null) {
    refusals.push("bathrooms_block_unusable");
    return { leaves, refusals, notices: [] };
  }
  if (!isPlainObject(block.status)) {
    refusals.push("bathroom_status_missing");
    return { leaves, refusals, notices: [] };
  }
  if (block.status.value !== "present") {
    refusals.push("bathroom_status_not_present");
    return { leaves, refusals, notices: [] };
  }
  const statusSourced = fileSourcedValue(block.status, "present", ["nps_pois"]);
  if (statusSourced === null) {
    refusals.push("bathroom_status_source_unusable");
    return { leaves, refusals, notices: [] };
  }

  const usable: Array<{ leaf: BathroomLeaf; value: unknown }> = [];
  for (const [name, leaf] of Object.entries(block)) {
    if (!NPS_BATHROOM_LEAVES.includes(name as BathroomLeaf)) {
      refusals.push(`unexpected_bathroom_leaf_${name}`);
      continue;
    }
    if (name === "status") {
      usable.push({ leaf: "status", value: "present" });
    } else if (name === "type") {
      const value = isPlainObject(leaf) ? leaf.value : undefined;
      if (BATHROOM_TYPES.includes(value as TrailheadBathroomType)) {
        usable.push({ leaf: "type", value });
      } else {
        refusals.push("bathroom_type_unusable");
      }
    } else {
      const note = nonEmptyStringValue(leaf);
      if (note === null) refusals.push("bathroom_season_note_unusable");
      else usable.push({ leaf: "season_note", value: note });
    }
  }
  for (const candidate of usable) {
    // Status is already settled above; re-deriving it here would be a second
    // implementation of the rule the block rests on.
    const sourced =
      candidate.leaf === "status"
        ? statusSourced
        : fileSourcedValue(block[candidate.leaf], candidate.value, ["nps_pois"]);
    if (sourced === null) {
      refusals.push(`bathroom_${candidate.leaf}_source_unusable`);
      continue;
    }
    leaves.push({ block: "bathrooms", leaf: candidate.leaf, source: "nps_pois", rowKey, sourced });
  }
  return { leaves, refusals, notices: [] };
}

/**
 * NPS row → parking leaves.
 *
 * Same shape as the bathroom half, and two rules of its own.
 *
 * **A `capacity_vehicles` arriving on an NPS leaf is refused by name.** The
 * Park Service publishes no capacity field, so a number here can only be a
 * regression that started turning polygon area into vehicles — and a number
 * nobody counted, in the leaf counted numbers live in, reads exactly like a
 * counted one.
 *
 * **A `capacity_range` must be spelled one of the five ways the calibration
 * spells it.** The list is checked, never parsed: an unknown bucket string is
 * refused rather than passed through to a renderer that would print the raw
 * value, and a number arriving in this leaf is refused for the same reason it
 * would be refused in the other one.
 */
export function npsParkingLeafCandidates(row: NpsFactRow): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const rowKey = npsRowKey(row);
  if (row.parking === undefined) return { leaves, refusals, notices: [] };

  const block = isPlainObject(row.parking) ? row.parking : null;
  if (block === null) {
    refusals.push("parking_block_unusable");
    return { leaves, refusals, notices: [] };
  }
  for (const [name, leaf] of Object.entries(block)) {
    if (!NPS_PARKING_LEAVES.includes(name as ParkingLeaf)) {
      refusals.push(`unexpected_parking_leaf_${name}`);
      continue;
    }
    let value: unknown = null;
    if (name === "type") {
      const raw = isPlainObject(leaf) ? leaf.value : undefined;
      value = PARKING_TYPES.includes(raw as TrailheadParkingType) ? raw : null;
    } else if (name === "capacity_range") {
      const raw = isPlainObject(leaf) ? leaf.value : undefined;
      value = CAPACITY_RANGES.includes(raw as (typeof CAPACITY_RANGES)[number]) ? raw : null;
    } else {
      value = nonEmptyStringValue(leaf);
    }
    if (value === null) {
      refusals.push(`parking_${name}_unusable`);
      continue;
    }
    const sourced = fileSourcedValue(leaf, value, ["nps_parking"]);
    if (sourced === null) {
      refusals.push(`parking_${name}_source_unusable`);
      continue;
    }
    leaves.push({ block: "parking", leaf: name as ParkingLeaf, source: "nps_parking", rowKey, sourced });
  }
  return { leaves, refusals, notices: [] };
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

export interface ConflictNote {
  leaf: string;
  kept: unknown;
  dropped: unknown;
  reason: string;
}

function sourceKind(candidate: LeafCandidate): string {
  return candidate.sourced.source.kind;
}

/**
 * Which of two claims about the same leaf wins:
 *   - fee_required: true wins, the stricter claim;
 *   - capacity_vehicles: an explicit page number beats anything else;
 *   - an explicit agency claim beats an NPS spatial join;
 *   - otherwise the agency dataset (usfs_edw) beats the web page (usfs_web).
 * Equal footing keeps the incumbent, so resolution is order-stable.
 *
 * The NPS rule sits above the last one and below the first two because of what
 * the two kinds of claim are. A Forest Service row saying `Vault toilet(s)` is
 * the agency describing a site it named; an NPS bathroom leaf is a restroom
 * that happens to be within 150 m of a point, with no name on either side
 * tying them together. Where a trailhead sits near a park boundary both can
 * land on `bathrooms.type` — and the one that knows which site it is talking
 * about is the one to keep.
 */
export function preferCandidate(
  current: LeafCandidate,
  next: LeafCandidate
): { winner: LeafCandidate; reason: string } {
  const leaf = leafKey(current);
  if (leaf === "parking.fee_required") {
    if (current.sourced.value === next.sourced.value) return { winner: current, reason: "same_value" };
    if (next.sourced.value === true) return { winner: next, reason: "fee_required_true_wins" };
    return { winner: current, reason: "fee_required_true_wins" };
  }
  if (leaf === "parking.capacity_vehicles") {
    const currentIsPage = sourceKind(current) === WEB_SOURCE_KIND;
    const nextIsPage = sourceKind(next) === WEB_SOURCE_KIND;
    if (nextIsPage && !currentIsPage) return { winner: next, reason: "page_capacity_wins" };
    if (currentIsPage && !nextIsPage) return { winner: current, reason: "page_capacity_wins" };
    return { winner: current, reason: "first_seen" };
  }
  const currentIsNps = isNpsSourceKind(sourceKind(current));
  const nextIsNps = isNpsSourceKind(sourceKind(next));
  if (currentIsNps !== nextIsNps) {
    return currentIsNps
      ? { winner: next, reason: "explicit_over_nps_join" }
      : { winner: current, reason: "explicit_over_nps_join" };
  }
  const currentIsEdw = sourceKind(current) === EDW_SOURCE_KIND;
  const nextIsEdw = sourceKind(next) === EDW_SOURCE_KIND;
  if (nextIsEdw && !currentIsEdw) return { winner: next, reason: "edw_over_web" };
  if (currentIsEdw && !nextIsEdw) return { winner: current, reason: "edw_over_web" };
  return { winner: current, reason: "first_seen" };
}

export function resolveLeafConflicts(candidates: LeafCandidate[]): {
  chosen: LeafCandidate[];
  conflicts: ConflictNote[];
} {
  const byLeaf = new Map<string, LeafCandidate>();
  const order: string[] = [];
  const conflicts: ConflictNote[] = [];
  for (const candidate of candidates) {
    const key = leafKey(candidate);
    const current = byLeaf.get(key);
    if (!current) {
      byLeaf.set(key, candidate);
      order.push(key);
      continue;
    }
    const { winner, reason } = preferCandidate(current, candidate);
    const loser = winner === current ? candidate : current;
    if (winner.sourced.value !== loser.sourced.value || sourceKind(winner) !== sourceKind(loser)) {
      conflicts.push({ leaf: key, kept: winner.sourced.value, dropped: loser.sourced.value, reason });
    }
    byLeaf.set(key, winner);
  }
  return { chosen: order.map((key) => byLeaf.get(key) as LeafCandidate), conflicts };
}

// ---------------------------------------------------------------------------
// Building and merging amenities
// ---------------------------------------------------------------------------

export function buildTrailheadAmenities(chosen: LeafCandidate[]): TrailheadAmenities {
  const amenities: TrailheadAmenities = {};
  for (const candidate of chosen) {
    const block = (amenities[candidate.block] ?? {}) as Record<string, SourcedValue<unknown>>;
    block[candidate.leaf] = candidate.sourced;
    (amenities as Record<string, unknown>)[candidate.block] = block;
  }
  return amenities;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stable stringification (keys sorted at every level) for change detection. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Leaves in a merged amenities object, counted across every block. */
export function countAmenityLeaves(amenities: Record<string, unknown>): number {
  let leaves = 0;
  for (const block of Object.values(amenities)) {
    if (isPlainObject(block)) leaves += Object.keys(block).length;
    else leaves += 1;
  }
  return leaves;
}

/**
 * Which payloads to show a human before they approve an apply. Richest first,
 * so the sample shows what a full row looks like, and ties broken by id so two
 * dry runs over the same data print the same rows.
 */
export function selectSamplePayloads<T extends { id: string; merged: Record<string, unknown> }>(
  pending: readonly T[],
  limit: number
): T[] {
  if (limit <= 0) return [];
  return [...pending]
    .sort((a, b) => {
      const byLeaves = countAmenityLeaves(b.merged) - countAmenityLeaves(a.merged);
      return byLeaves !== 0 ? byLeaves : a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export interface MergeResult {
  merged: Record<string, unknown>;
  changed: boolean;
  /** Leaf keys actually written, e.g. "parking.fee_required". */
  appliedLeaves: string[];
  /** Leaf keys held by another source and left alone. */
  preservedLeaves: string[];
  /** NPS leaves that yielded to an explicit agency claim already stored. */
  deferredLeaves: string[];
}

/**
 * Merge trailhead leaves into whatever the row already holds. Blocks and
 * leaves this importer did not produce survive untouched, and a leaf written
 * by a source outside MANAGED_SOURCE_KINDS (a human check, a future importer)
 * is never overwritten.
 *
 * One more rule, and it is the same one `preferCandidate` applies inside a
 * single run: **an NPS leaf never overwrites an explicit agency claim already
 * on the row.** Both are needed because they catch different runs. The
 * resolver settles a leaf two sources both produced today; this settles the
 * run where the Forest Service row that wrote the leaf last quarter no longer
 * clears the name gate, and the only candidate left is a spatial join.
 */
export function mergeTrailheadAmenities(existing: unknown, incoming: TrailheadAmenities): MergeResult {
  const base: Record<string, unknown> = isPlainObject(existing)
    ? (JSON.parse(JSON.stringify(existing)) as Record<string, unknown>)
    : {};
  const before = canonicalJson(isPlainObject(existing) ? existing : {});
  const appliedLeaves: string[] = [];
  const preservedLeaves: string[] = [];
  const deferredLeaves: string[] = [];

  for (const [blockName, blockValue] of Object.entries(incoming)) {
    if (!isPlainObject(blockValue)) continue;
    const currentBlock = isPlainObject(base[blockName]) ? (base[blockName] as Record<string, unknown>) : {};
    for (const [leafName, leafValue] of Object.entries(blockValue)) {
      const key = `${blockName}.${leafName}`;
      const currentLeaf = currentBlock[leafName];
      const incomingKind =
        isPlainObject(leafValue) && isPlainObject(leafValue.source)
          ? leafValue.source.kind
          : undefined;
      if (isPlainObject(currentLeaf)) {
        const currentKind = isPlainObject(currentLeaf.source) ? currentLeaf.source.kind : undefined;
        if (typeof currentKind === "string" && !MANAGED_SOURCE_KINDS.includes(currentKind)) {
          preservedLeaves.push(key);
          continue;
        }
        if (
          isNpsSourceKind(incomingKind as string | undefined) &&
          typeof currentKind === "string" &&
          !isNpsSourceKind(currentKind)
        ) {
          deferredLeaves.push(key);
          continue;
        }
      }
      currentBlock[leafName] = leafValue;
      appliedLeaves.push(key);
    }
    base[blockName] = currentBlock;
  }

  return {
    merged: base,
    changed: canonicalJson(base) !== before,
    appliedLeaves,
    preservedLeaves,
    deferredLeaves,
  };
}
