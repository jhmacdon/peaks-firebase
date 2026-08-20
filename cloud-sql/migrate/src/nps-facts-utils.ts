// Pure helpers for the NPS trailhead-facts normalizer: the POI vocabulary, the
// anomaly rules, the distance gate, and the two blocks a matched trailhead
// gets. Nothing here touches pg, fs or duckdb, so every decision the
// normalization makes can be unit-tested without a database — the same split
// as trailhead-facts-utils.ts against import-trailhead-facts.ts.
//
// One rule governs the whole file and is worth stating before anything else.
// **NPS is presence-only.** It records the restrooms and lots it has mapped and
// says nothing at all about the ones it has not. A trailhead with no toilet POI
// within the gate is indistinguishable from a trailhead nobody surveyed, so
// nothing here may ever produce `absent`, and no row is emitted for a trailhead
// with no NPS feature near it — an emitted row saying "considered, found
// nothing" is that forbidden negative wearing a diagnostic's clothes.

import { distanceMeters, type SourcePoint } from "./trailhead-facts-utils";
import type {
  SourcedValue,
  TrailheadBathroomType,
  TrailheadParkingType,
} from "./lib/amenities";

export const NPS_SOURCE_NAME = "National Park Service";
export const NPS_LICENSE = "public domain (US federal government)";

/** Source kinds, one per NPS service, as they appear on every leaf. */
export const NPS_POIS_SOURCE_KIND = "nps_pois";
export const NPS_PARKING_SOURCE_KIND = "nps_parking";

/** Manifest dataset names, which carry each service's URL and snapshot date. */
export const NPS_POIS_DATASET = "nps_public_pois";
export const NPS_PARKING_DATASET = "nps_public_parking_lots";

/**
 * How near an NPS feature has to be to answer for a trailhead.
 *
 * 150 m rather than the 250 m the fee and bathroom importers match at, because
 * this is a spatial join with no name to check it against: those sources carry
 * a site name that has to resemble the destination's before anything is
 * written, and this one has only the distance. research-bathrooms.md §2.3
 * measured the NPS toilet join at 100/200/400 m — 20.4%, 28.4%, 35.4% of NPS
 * trailheads — so the curve is flat enough that the tighter gate costs little
 * and buys a join a person can defend.
 */
export const NPS_JOIN_RADIUS_M = 150;

/**
 * The POI vocabulary, mapped to the Peaks bathroom type.
 *
 * `Restroom`, `Toilet` and `Floating Restroom` name a fact without naming its
 * plumbing, so they land on `unspecified` rather than being guessed into a
 * bucket. Vault and pit are one bucket in the Peaks schema. Anything outside
 * this map is not a toilet POI and never reaches the join.
 */
export const NPS_TOILET_POI_TYPES: Readonly<Record<string, TrailheadBathroomType>> = {
  "vault toilet": "vault_pit",
  "pit toilet": "vault_pit",
  "flush toilet": "flush",
  restroom: "unspecified",
  toilet: "unspecified",
  "floating restroom": "unspecified",
};

/** The Peaks bathroom type for one `POITYPE`, or null when it is not a toilet. */
export function toiletTypeForPoi(poiType: unknown): TrailheadBathroomType | null {
  if (typeof poiType !== "string") return null;
  const key = poiType.trim().toLowerCase().replace(/\s+/g, " ");
  return NPS_TOILET_POI_TYPES[key] ?? null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

/**
 * A feature the catalog should not speak for.
 *
 * Three fields say a mapped feature is not a usable fact, and all three are
 * read the same way for a toilet POI and for a parking polygon:
 *
 * - `POISTATUS` — `Planned` and `Not Existing` are features that are not there,
 *   `Decommissioned` is one that stopped being there, `Temporarily Closed` is
 *   one a hiker cannot use today.
 * - `OPENTOPUBLIC` = `No` — mapped, real, and not for visitors.
 * - `ISEXTANT` = `False` / `No` — the layer's own "this does not exist".
 *
 * Every one of them means **drop this candidate and look at the next**, never
 * "there is no restroom here": an anomaly is the source declining to answer,
 * and turning a declined answer into a negative is exactly the claim NPS data
 * cannot support.
 */
export function npsFeatureAnomaly(row: Record<string, unknown>): string | null {
  const status = lower(row.POISTATUS);
  if (status === "planned") return "status_planned";
  if (status === "not existing") return "status_not_existing";
  if (status === "decommissioned") return "status_decommissioned";
  if (status === "temporarily closed") return "status_temporarily_closed";
  if (lower(row.OPENTOPUBLIC) === "no") return "not_open_to_public";
  const extant = lower(row.ISEXTANT);
  if (extant === "false" || extant === "no") return "not_extant";
  return null;
}

/** Placeholders the NPS layers use where a real string would go. */
const PLACEHOLDER_TEXT = new Set(["unknown", "none", "n/a", "na", "null", "tbd", "-", "--"]);

/**
 * `SEASDESC` as a season note, verbatim or not at all.
 *
 * The good ones are sentences a person wrote — "May 1 - Oct 31 (check park
 * website)" — and rewriting them would only lose the parenthetical that makes
 * them honest. The rest are the layer's placeholders, and a season note reading
 * "Unknown" is worse than no note: it prints the absence of information as
 * though it were information.
 */
export function npsSeasonNote(value: unknown): string | null {
  const note = text(value);
  if (note.length === 0) return null;
  return PLACEHOLDER_TEXT.has(note.toLowerCase()) ? null : note;
}

/**
 * Which field a lot's name came from.
 *
 * `LOTNAME` is filled on 1,314 of 6,740 lots and `MAPLABEL` on 5,672, and the
 * two disagree about which rows they cover: **every lot this join matches today
 * has a MAPLABEL and none has a LOTNAME**, Paradise's upper lot included. So
 * the label is a fallback rather than a nicety — without it the parking block
 * would carry no note at all.
 */
export type NpsLotNameField = "LOTNAME" | "MAPLABEL";

export interface NpsLotName {
  text: string;
  field: NpsLotNameField;
}

export function npsLotName(row: Record<string, unknown>): NpsLotName | null {
  const lotName = text(row.LOTNAME);
  if (lotName.length > 0 && !PLACEHOLDER_TEXT.has(lotName.toLowerCase())) {
    return { text: lotName, field: "LOTNAME" };
  }
  const label = text(row.MAPLABEL);
  if (label.length > 0 && !PLACEHOLDER_TEXT.has(label.toLowerCase())) {
    return { text: label, field: "MAPLABEL" };
  }
  return null;
}

/**
 * A lot the public does not park in, named as such.
 *
 * `LOTTYPE` is null on 5,448 of 6,740 rows and `OPENTOPUBLIC` is Unknown on
 * 6,091, so the name is the only thing that separates a visitor lot from the
 * park's maintenance yard. Longmire's maintenance-area lot sits 88 m from the
 * Eagle Peak trailhead and would otherwise be published as its parking.
 *
 * Like an anomaly this drops one candidate rather than the trailhead: the next
 * lot within the gate may be the visitor one.
 */
export const NON_PUBLIC_LOT_PATTERN =
  /\b(maintenance|employee|employees|staff|residence|residences|residential|administrative|administration|government|utility|shop|warehouse)\b/i;

export function isNonPublicLotName(name: string | null | undefined): boolean {
  return typeof name === "string" && NON_PUBLIC_LOT_PATTERN.test(name);
}

/**
 * A name that says nothing the `type` leaf has not said already.
 *
 * "Parking Lot" appears as a MAPLABEL 375 times and "Parking" 83 more. Written
 * under a row that already reads "Parking lot" it is the same word twice, so a
 * label made only of these tokens carries no note.
 */
const GENERIC_LOT_TOKENS = new Set([
  "parking",
  "park",
  "lot",
  "lots",
  "area",
  "areas",
  "pullout",
  "pull",
  "out",
  "turnout",
  "space",
  "spaces",
  "public",
  "visitor",
  "visitors",
  "the",
  "and",
  "of",
  "at",
  "a",
]);

/** The source's own truncation marker, left on a label it cut short. */
export const TRUNCATED_LOT_NAME = /\*\s*$/;

export type LotNoteOutcome =
  | { kind: "note"; text: string; field: NpsLotNameField }
  | { kind: "refused"; reason: "no_name" | "generic_name" | "truncated_name" };

/**
 * The lot's name as a `parking.location_note`, or the reason it is not one.
 *
 * A truncated label is refused rather than trimmed. "ANCIENT GROVES (NIGHT
 * SHADOWS) NATURE TRAIL PARKI*" is the layer telling us it ran out of
 * characters; cutting the marker off leaves "PARKI", and guessing the rest
 * invents a name. The lot itself still publishes — only its note goes.
 *
 * The text is kept exactly as the agency wrote it, capitals and all. Case is a
 * rendering decision, and the one place in this codebase that makes it —
 * `roadSurface` in the web client — makes it at render time, where a wrong
 * guess can be fixed without a re-import.
 */
export function npsLotLocationNote(row: Record<string, unknown>): LotNoteOutcome {
  const name = npsLotName(row);
  if (name === null) return { kind: "refused", reason: "no_name" };
  if (TRUNCATED_LOT_NAME.test(name.text)) return { kind: "refused", reason: "truncated_name" };
  const tokens = name.text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.every((token) => GENERIC_LOT_TOKENS.has(token))) {
    return { kind: "refused", reason: "generic_name" };
  }
  return { kind: "note", text: name.text, field: name.field };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** An ArcGIS polygon as the JSONL carries it: rings of `[lng, lat]` pairs. */
export type PolygonRings = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** The polygon's bounding box, or null when it holds no usable vertex. */
export function ringsBounds(rings: PolygonRings): Bounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      const lng = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (minLat === Infinity) return null;
  return { minLat, maxLat, minLng, maxLng };
}

/** A box grown by `radiusM`, so a cheap test can reject a far polygon whole. */
export function padBounds(bounds: Bounds, radiusM: number): Bounds {
  const latPad = radiusM / 111_320;
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180);
  const lngPad = radiusM / Math.max(1, 111_320 * Math.cos(midLat));
  return {
    minLat: bounds.minLat - latPad,
    maxLat: bounds.maxLat + latPad,
    minLng: bounds.minLng - lngPad,
    maxLng: bounds.maxLng + lngPad,
  };
}

export function boundsContain(bounds: Bounds, point: SourcePoint): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lng >= bounds.minLng &&
    point.lng <= bounds.maxLng
  );
}

/**
 * Metres from a point to a polygon, zero when the point is inside it.
 *
 * Distance to the polygon, not to its centroid: a trailhead standing in the
 * middle of Paradise's upper lot is 0 m from the lot and 40 m from its centre,
 * and 6,740 lots at trailhead scale make the honest measurement cheap. Rings
 * are filled even-odd, which is what makes a hole a hole — a point inside one
 * is outside the polygon and its distance is to the hole's edge.
 *
 * The projection is the local equirectangular one `distanceMeters` uses. At a
 * 150 m gate its error is centimetres, and it keeps one distance model across
 * the two joins rather than two that disagree at the boundary.
 */
export function metresToPolygon(point: SourcePoint, rings: PolygonRings): number | null {
  const rad = Math.PI / 180;
  const scale = 6_371_000 * rad;
  const cosLat = Math.cos(point.lat * rad);
  const project = (lng: number, lat: number): [number, number] => [
    (lng - point.lng) * scale * cosLat,
    (lat - point.lat) * scale,
  ];

  let best = Infinity;
  let inside = false;
  for (const ring of rings) {
    const projected: Array<[number, number]> = [];
    for (const vertex of ring) {
      const lng = Number(vertex[0]);
      const lat = Number(vertex[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      projected.push(project(lng, lat));
    }
    if (projected.length < 2) continue;
    let crossings = 0;
    for (let i = 0; i < projected.length; i += 1) {
      const [x1, y1] = projected[i];
      const [x2, y2] = projected[(i + 1) % projected.length];
      if (y1 > 0 !== y2 > 0) {
        const x = x1 + ((0 - y1) * (x2 - x1)) / (y2 - y1);
        if (x > 0) crossings += 1;
      }
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / lengthSquared));
      best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy));
    }
    if (crossings % 2 === 1) inside = !inside;
  }
  if (best === Infinity) return null;
  return inside ? 0 : best;
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

/** Where a fact came from, in the shape `lib/amenities.ts` stores. */
export interface NpsLeafSource {
  kind: string;
  name: string;
  url?: string;
  license?: string;
}

export interface NpsSource extends NpsLeafSource {
  retrieved_at: string;
}

/** Both services' provenance, read once from the download manifest. */
export interface NpsSourceBook {
  pois: NpsSource;
  parking: NpsSource;
}

export function npsSourcedValue<T>(value: T, source: NpsSource): SourcedValue<T> {
  const { retrieved_at, ...rest } = source;
  return { value, source: rest, retrieved_at };
}

/** One candidate feature, already measured against the trailhead. */
export interface NpsCandidate {
  distanceM: number;
  row: Record<string, unknown>;
}

/** A candidate this join walked past, and why. */
export interface SkippedCandidate {
  reason: string;
  distance_m: number;
  poi_type?: string | null;
  lot_name?: string | null;
}

export interface NpsBathroomFacts {
  status: SourcedValue<"present">;
  type: SourcedValue<TrailheadBathroomType>;
  season_note?: SourcedValue<string>;
}

export interface NpsBathroomDiagnostics {
  distance_m: number;
  poi_type: string;
  poi_name: string | null;
  poi_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  poi_status: string | null;
  open_to_public: string | null;
  seasonal: string | null;
  candidates_within_gate: number;
  skipped: SkippedCandidate[];
}

export interface NpsBathroomOutcome {
  facts: NpsBathroomFacts;
  diagnostics: NpsBathroomDiagnostics;
}

/**
 * What the join found, and what it walked past on the way.
 *
 * `skipped` is returned beside the outcome rather than only inside it, because
 * the interesting refusal is the one that leaves no outcome at all: a trailhead
 * whose only nearby lot is the maintenance yard produces no row, and a summary
 * that read its reasons out of the row would never mention it.
 */
export interface NpsBathroomResult {
  outcome: NpsBathroomOutcome | null;
  skipped: SkippedCandidate[];
  /** How many candidates the gate let through, refused or not. */
  candidates: number;
}

function identity(row: Record<string, unknown>): string | null {
  const geometryId = text(row.GEOMETRYID);
  if (geometryId.length > 0) return geometryId;
  const objectId = row.OBJECTID;
  return objectId === null || objectId === undefined ? null : String(objectId);
}

function orNull(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The nearest usable toilet POI, as bathroom leaves.
 *
 * Candidates arrive already inside the gate and sorted by distance. The first
 * one that is a toilet type and carries no anomaly answers; the ones walked
 * past are recorded with their reason so a person reading the diagnostics can
 * see the restroom that was there and was not used. When every candidate is
 * refused the trailhead gets no bathroom block — **never `absent`**.
 */
export function npsBathroomFacts(
  candidates: readonly NpsCandidate[],
  source: NpsSource
): NpsBathroomResult {
  const skipped: SkippedCandidate[] = [];
  for (const candidate of candidates) {
    const poiType = text(candidate.row.POITYPE);
    const type = toiletTypeForPoi(poiType);
    const distance = Number(candidate.distanceM.toFixed(1));
    if (type === null) {
      skipped.push({ reason: "not_a_toilet_type", distance_m: distance, poi_type: poiType || null });
      continue;
    }
    const anomaly = npsFeatureAnomaly(candidate.row);
    if (anomaly !== null) {
      skipped.push({ reason: anomaly, distance_m: distance, poi_type: poiType || null });
      continue;
    }
    const facts: NpsBathroomFacts = {
      status: npsSourcedValue("present" as const, source),
      type: npsSourcedValue(type, source),
    };
    const seasonNote = npsSeasonNote(candidate.row.SEASDESC);
    if (seasonNote !== null) facts.season_note = npsSourcedValue(seasonNote, source);
    return {
      outcome: {
        facts,
        diagnostics: {
          distance_m: distance,
          poi_type: poiType,
          poi_name: orNull(candidate.row.POINAME),
          poi_id: identity(candidate.row),
          unit_code: orNull(candidate.row.UNITCODE),
          unit_name: orNull(candidate.row.UNITNAME),
          poi_status: orNull(candidate.row.POISTATUS),
          open_to_public: orNull(candidate.row.OPENTOPUBLIC),
          seasonal: orNull(candidate.row.SEASONAL),
          candidates_within_gate: candidates.length,
          skipped,
        },
      },
      skipped,
      candidates: candidates.length,
    };
  }
  return { outcome: null, skipped, candidates: candidates.length };
}

export interface NpsParkingFacts {
  type: SourcedValue<TrailheadParkingType>;
  location_note?: SourcedValue<string>;
}

export interface NpsParkingDiagnostics {
  distance_m: number;
  /** True where the trailhead stands inside the lot polygon. */
  inside_lot: boolean;
  lot_id: string | null;
  lot_name: string | null;
  lot_name_field: NpsLotNameField | null;
  /** Why the lot's name is not a note, when it is not one. */
  location_note_refused: string | null;
  lot_type: string | null;
  unit_code: string | null;
  unit_name: string | null;
  open_to_public: string | null;
  seasonal: string | null;
  /**
   * `SEASDESC` verbatim, carried and not published.
   *
   * The parking block has no seasonal leaf, and inventing one on a source that
   * populates this field on 419 of 6,740 lots — none of them a lot this join
   * matches today — would be schema for its own sake. It sits here so the day
   * a seasonal leaf exists, the evidence for it is already in the file.
   */
  seasonal_description: string | null;
  candidates_within_gate: number;
  skipped: SkippedCandidate[];
}

export interface NpsParkingOutcome {
  facts: NpsParkingFacts;
  diagnostics: NpsParkingDiagnostics;
}

/** The parking join's outcome and the candidates it walked past. */
export interface NpsParkingResult {
  outcome: NpsParkingOutcome | null;
  skipped: SkippedCandidate[];
  candidates: number;
}

/**
 * The nearest usable parking polygon, as parking leaves.
 *
 * Every lot in this layer is a mapped polygon with marked spaces, so the type
 * is `lot` whatever `LOTTYPE` says — an `Overlook` lot is still a lot, and
 * `roadside` in the Peaks vocabulary means a pullout this layer does not carry.
 *
 * **No capacity, ever.** research-parking.md §2.5 offers polygon area as a
 * proxy at 30 m² a space and says in the same breath that the ratio was never
 * calibrated, because Overpass went down before the regression could run. A
 * number nobody checked reads exactly like a number somebody did.
 */
export function npsParkingFacts(
  candidates: readonly NpsCandidate[],
  source: NpsSource
): NpsParkingResult {
  const skipped: SkippedCandidate[] = [];
  for (const candidate of candidates) {
    const distance = Number(candidate.distanceM.toFixed(1));
    const name = npsLotName(candidate.row);
    const anomaly = npsFeatureAnomaly(candidate.row);
    if (anomaly !== null) {
      skipped.push({ reason: anomaly, distance_m: distance, lot_name: name?.text ?? null });
      continue;
    }
    if (isNonPublicLotName(name?.text)) {
      skipped.push({ reason: "non_public_lot", distance_m: distance, lot_name: name?.text ?? null });
      continue;
    }
    const facts: NpsParkingFacts = { type: npsSourcedValue("lot" as const, source) };
    const note = npsLotLocationNote(candidate.row);
    if (note.kind === "note") facts.location_note = npsSourcedValue(note.text, source);
    return {
      outcome: {
        facts,
        diagnostics: {
          distance_m: distance,
          inside_lot: distance === 0,
          lot_id: identity(candidate.row),
          lot_name: name?.text ?? null,
          lot_name_field: name?.field ?? null,
          location_note_refused: note.kind === "refused" ? note.reason : null,
          lot_type: orNull(candidate.row.LOTTYPE),
          unit_code: orNull(candidate.row.UNITCODE),
          unit_name: orNull(candidate.row.UNITNAME),
          open_to_public: orNull(candidate.row.OPENTOPUBLIC),
          seasonal: orNull(candidate.row.SEASONAL),
          seasonal_description: npsSeasonNote(candidate.row.SEASDESC),
          candidates_within_gate: candidates.length,
          skipped,
        },
      },
      skipped,
      candidates: candidates.length,
    };
  }
  return { outcome: null, skipped, candidates: candidates.length };
}

/** One trailhead's row of `nps-trailhead-facts.jsonl`. */
export interface NpsFactRow {
  destination_id: string;
  destination_name: string;
  bathrooms?: NpsBathroomFacts;
  parking?: NpsParkingFacts;
  /** Join evidence. Read by people, never imported — a test pins that. */
  diagnostics: {
    bathroom?: NpsBathroomDiagnostics;
    parking?: NpsParkingDiagnostics;
  };
}

export interface Trailhead extends SourcePoint {
  id: string;
  name: string;
}

/**
 * One trailhead's row, or null when NPS has nothing to say about it.
 *
 * Null rather than a row carrying two empty blocks: the file holds what the
 * Park Service knows, and a row saying "looked, found nothing" is the negative
 * this source cannot support, written down where a later reader would take it
 * for one.
 */
export function buildNpsFactRow(
  trailhead: Trailhead,
  bathroom: NpsBathroomOutcome | null,
  parking: NpsParkingOutcome | null
): NpsFactRow | null {
  if (bathroom === null && parking === null) return null;
  const row: NpsFactRow = {
    destination_id: trailhead.id,
    destination_name: trailhead.name,
    diagnostics: {},
  };
  if (bathroom !== null) {
    row.bathrooms = bathroom.facts;
    row.diagnostics.bathroom = bathroom.diagnostics;
  }
  if (parking !== null) {
    row.parking = parking.facts;
    row.diagnostics.parking = parking.diagnostics;
  }
  return row;
}

/** Candidates within the gate, nearest first — the input both blocks expect. */
export function candidatesWithinGate(
  trailhead: SourcePoint,
  features: ReadonlyArray<{ point: SourcePoint; row: Record<string, unknown> }>,
  radiusM: number = NPS_JOIN_RADIUS_M
): NpsCandidate[] {
  const near: NpsCandidate[] = [];
  for (const feature of features) {
    const distanceM = distanceMeters(trailhead, feature.point);
    if (distanceM <= radiusM) near.push({ distanceM, row: feature.row });
  }
  return near.sort((a, b) => a.distanceM - b.distanceM);
}
