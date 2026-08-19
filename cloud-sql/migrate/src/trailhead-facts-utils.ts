// Pure helpers for the trailhead-facts importer: name normalization, the
// two-gate match, per-source leaf extraction, conflict resolution, and the
// merge into destinations.amenities.
//
// Nothing here touches pg or fs, so every decision the importer makes can be
// unit-tested without a database — the same split as padus-area-utils.ts and
// import-padus-areas.ts.

import type {
  SourcedValue,
  TrailheadAmenities,
  TrailheadBathrooms,
  TrailheadBathroomStatus,
  TrailheadBathroomType,
  TrailheadParking,
} from "./lib/amenities";

/** Source names recorded in data_source_runs, one per input file. */
export type TrailheadFactSource = "usfs_fees" | "usfs_bathrooms" | "usfs_pages";

export const TRAILHEAD_FACT_SOURCES: readonly TrailheadFactSource[] = [
  "usfs_fees",
  "usfs_bathrooms",
  "usfs_pages",
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

/** Source kinds this importer owns and may overwrite on a re-run. */
export const MANAGED_SOURCE_KINDS: readonly string[] = [EDW_SOURCE_KIND, WEB_SOURCE_KIND];

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

export interface MatchCandidate {
  destinationId: string;
  destinationName: string;
  distanceM: number;
  similarity: number;
}

export type MatchOutcome =
  | { kind: "matched"; candidate: MatchCandidate }
  | { kind: "name_below_threshold"; best: MatchCandidate }
  | { kind: "no_nearby_trailhead" };

/**
 * Gate 2. Candidates have already passed gate 1 (a trailhead-featured
 * destination within the radius). Best similarity wins; the nearer point
 * breaks a tie.
 */
export function chooseMatch(candidates: MatchCandidate[], threshold: number): MatchOutcome {
  if (candidates.length === 0) return { kind: "no_nearby_trailhead" };
  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (
      candidate.similarity > best.similarity ||
      (candidate.similarity === best.similarity && candidate.distanceM < best.distanceM)
    ) {
      best = candidate;
    }
  }
  return best.similarity >= threshold ? { kind: "matched", candidate: best } : { kind: "name_below_threshold", best };
}

// ---------------------------------------------------------------------------
// Locating Forest Service page rows
// ---------------------------------------------------------------------------

export interface SourcePoint {
  lat: number;
  lng: number;
}

export type LocationIndex = Map<string, SourcePoint[]>;

/** Metres between two points, good enough at trailhead scale. */
export function distanceMeters(a: SourcePoint, b: SourcePoint): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return R * Math.hypot(x, y);
}

/**
 * Index EDW points by normalized name. The Forest Service page registry
 * carries no coordinates, so a page row borrows the coordinates of the EDW
 * trailhead with the same name.
 */
export function buildLocationIndex(rows: Array<{ name: string; lat: number; lng: number }>): LocationIndex {
  const index: LocationIndex = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
    const key = normalizeTrailheadName(row.name);
    if (key.length === 0) continue;
    const points = index.get(key);
    if (points) points.push({ lat: row.lat, lng: row.lng });
    else index.set(key, [{ lat: row.lat, lng: row.lng }]);
  }
  return index;
}

export type LocationLookup =
  | { kind: "located"; point: SourcePoint }
  | { kind: "unknown_name" }
  | { kind: "ambiguous"; spreadM: number };

/**
 * Resolve one name to a point. A name shared by trailheads further apart than
 * maxSpreadM is ambiguous — two different places, no way to tell which page
 * belongs to which — so it stays unlocated rather than risking a wrong write.
 */
export function resolveLocation(
  index: LocationIndex,
  name: string,
  maxSpreadM: number = TRAILHEAD_MATCH_RADIUS_M
): LocationLookup {
  const points = index.get(normalizeTrailheadName(name));
  if (!points || points.length === 0) return { kind: "unknown_name" };
  let spread = 0;
  for (const point of points) {
    spread = Math.max(spread, distanceMeters(points[0], point));
  }
  if (spread > maxSpreadM) return { kind: "ambiguous", spreadM: spread };
  return { kind: "located", point: points[0] };
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

export interface PageSectionRow {
  url: string;
  capacity_estimate: number | null;
  fills_early_note: string | null;
  fee_text: string | null;
  restroom_text: string | null;
  road_text: string | null;
  fetched_at: string;
}

export interface RegistryRow {
  url: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Leaf candidates
// ---------------------------------------------------------------------------

export type ParkingLeaf = keyof TrailheadParking;
export type BathroomLeaf = keyof TrailheadBathrooms;

export interface LeafCandidate {
  block: "parking" | "bathrooms";
  leaf: ParkingLeaf | BathroomLeaf;
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

function webSourced(row: PageSectionRow, value: unknown): SourcedValue<unknown> {
  return {
    value,
    source: {
      kind: WEB_SOURCE_KIND,
      name: USFS_SOURCE_NAME,
      url: row.url,
      license: USFS_LICENSE,
    },
    retrieved_at: row.fetched_at,
  };
}

function nonEmptyText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
}

/**
 * Fee row → parking leaves.
 *
 * Hard guard: fee_required=false never gets written without a verbatim quote.
 * The upstream `fee_charged='N'` flag is a lying default, so a no-fee claim
 * needs source text behind it or Peaks would tell people a fee site is free.
 */
export function feeLeafCandidates(row: FeeRow): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const rowKey = `${row.source_dataset}:${row.source_id}`;
  const push = (leaf: ParkingLeaf, value: unknown) => {
    leaves.push({ block: "parking", leaf, source: "usfs_fees", rowKey, sourced: edwSourced(row, value) });
  };

  if (row.fee_required === true) {
    push("fee_required", true);
  } else if (row.fee_required === false) {
    if (nonEmptyText(row.verbatim_quote)) push("fee_required", false);
    else refusals.push("fee_required_false_without_quote");
  }

  const dayFee = positiveNumber(row.day_fee_usd);
  if (dayFee !== null) push("day_fee_usd", dayFee);

  const annualFee = positiveNumber(row.annual_fee_usd);
  if (annualFee !== null) push("annual_fee_usd", annualFee);

  const passes = stringList(row.passes_accepted);
  if (passes) push("passes_accepted", passes);

  const waived = stringList(row.fee_waived_for);
  if (waived) push("fee_waived_for", waived);

  return { leaves, refusals };
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
  const rowKey = `${row.source_dataset}:${row.source_id}`;
  if (row.status !== "present" && row.status !== "absent") {
    refusals.push("status_unknown");
    return { leaves, refusals };
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

  return { leaves, refusals };
}

/** Page section row → parking leaves (capacity and the fills-early note). */
export function pageLeafCandidates(row: PageSectionRow): LeafExtraction {
  const leaves: LeafCandidate[] = [];
  const refusals: string[] = [];
  const push = (leaf: ParkingLeaf, value: unknown) => {
    leaves.push({ block: "parking", leaf, source: "usfs_pages", rowKey: row.url, sourced: webSourced(row, value) });
  };

  const capacity = positiveNumber(row.capacity_estimate);
  if (capacity !== null) push("capacity_vehicles", capacity);

  const fillsEarly = nonEmptyText(row.fills_early_note);
  if (fillsEarly) push("fills_early_note", fillsEarly);

  if (leaves.length === 0) refusals.push("no_structured_facts");
  return { leaves, refusals };
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
 *   - otherwise the agency dataset (usfs_edw) beats the web page (usfs_web).
 * Equal footing keeps the incumbent, so resolution is order-stable.
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

export interface MergeResult {
  merged: Record<string, unknown>;
  changed: boolean;
  /** Leaf keys actually written, e.g. "parking.fee_required". */
  appliedLeaves: string[];
  /** Leaf keys held by another source and left alone. */
  preservedLeaves: string[];
}

/**
 * Merge trailhead leaves into whatever the row already holds. Blocks and
 * leaves this importer did not produce survive untouched, and a leaf written
 * by a source outside MANAGED_SOURCE_KINDS (a human check, a future importer)
 * is never overwritten.
 */
export function mergeTrailheadAmenities(existing: unknown, incoming: TrailheadAmenities): MergeResult {
  const base: Record<string, unknown> = isPlainObject(existing)
    ? (JSON.parse(JSON.stringify(existing)) as Record<string, unknown>)
    : {};
  const before = canonicalJson(isPlainObject(existing) ? existing : {});
  const appliedLeaves: string[] = [];
  const preservedLeaves: string[] = [];

  for (const [blockName, blockValue] of Object.entries(incoming)) {
    if (!isPlainObject(blockValue)) continue;
    const currentBlock = isPlainObject(base[blockName]) ? (base[blockName] as Record<string, unknown>) : {};
    for (const [leafName, leafValue] of Object.entries(blockValue)) {
      const key = `${blockName}.${leafName}`;
      const currentLeaf = currentBlock[leafName];
      if (isPlainObject(currentLeaf)) {
        const currentKind = isPlainObject(currentLeaf.source) ? currentLeaf.source.kind : undefined;
        if (typeof currentKind === "string" && !MANAGED_SOURCE_KINDS.includes(currentKind)) {
          preservedLeaves.push(key);
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
  };
}
