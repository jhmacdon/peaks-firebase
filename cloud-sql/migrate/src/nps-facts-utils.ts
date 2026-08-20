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

import {
  estimateCapacityRange,
  fittedCapacityCurve,
  PARKING_CAPACITY_CALIBRATION,
  type TrailheadParkingCapacityRange,
} from "./parking-capacity";
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

/**
 * The fixture a POI's own name gives away, when its type does not.
 *
 * 356 of the points typed `Restroom`, `Toilet` or `Floating Restroom` are
 * named for the fixture they are — "Kautz Creek Vault Toilet", "Roaring
 * Springs Composting Toilet", "Canyon Overlook Parking Area Pit Toilet" —
 * which is a more specific fact than `unspecified`, written down by the same
 * agency in the next field along.
 *
 * Conservative on purpose. Only whole words, only the five the Peaks
 * vocabulary can hold, and **a name carrying two different fixture words is
 * refused rather than guessed at**: no name in the layer does that today, and
 * the day one does, the honest answer is the one the type already gave.
 */
export const POI_NAME_FIXTURES: ReadonlyArray<[RegExp, TrailheadBathroomType]> = [
  [/\bvault\b/i, "vault_pit"],
  [/\bpit\b/i, "vault_pit"],
  [/\bflush\b/i, "flush"],
  [/\bcompost(?:ing)?\b/i, "composting"],
  [/\bportable\b|\bporta[- ]?potty\b/i, "portable"],
];

export function toiletTypeFromName(poiName: unknown): TrailheadBathroomType | null {
  if (typeof poiName !== "string" || poiName.trim().length === 0) return null;
  const found = new Set<TrailheadBathroomType>();
  for (const [pattern, type] of POI_NAME_FIXTURES) {
    if (pattern.test(poiName)) found.add(type);
  }
  return found.size === 1 ? [...found][0] : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

/**
 * A field the layer filled with something this code cannot read.
 *
 * Null and undefined are ordinary — `POISTATUS` is null on 30,235 of 35,567
 * points — so they are not anomalies. A **present** value that is not a string
 * is: a boolean `false` in `OPENTOPUBLIC` says the lot is closed to the public
 * as plainly as the string `"No"` does, and reading it through a
 * string-coercion that yields `""` would publish it as a visitor lot. So the
 * rule is fail closed: a value of an unexpected type refuses the candidate
 * rather than falling through the checks below.
 */
function unreadable(value: unknown): boolean {
  return value !== null && value !== undefined && typeof value !== "string";
}

/**
 * A feature the catalog should not speak for.
 *
 * Three fields say a mapped feature is not a usable fact:
 *
 * - `POISTATUS` — `Planned` and `Not Existing` are features that are not there,
 *   `Decommissioned` is one that stopped being there, `Temporarily Closed` is
 *   one a hiker cannot use today. **The POI layer only.** The parking layer has
 *   no such field, which is why this reads all three rather than requiring any.
 * - `OPENTOPUBLIC` = `No` — mapped, real, and not for visitors. Both layers.
 * - `ISEXTANT` = `False` / `No` — the layer's own "this does not exist". Both
 *   layers.
 *
 * Every one of them means **drop this candidate and look at the next**, never
 * "there is no restroom here": an anomaly is the source declining to answer,
 * and turning a declined answer into a negative is exactly the claim NPS data
 * cannot support.
 */
export function npsFeatureAnomaly(row: Record<string, unknown>): string | null {
  if (unreadable(row.POISTATUS)) return "status_unreadable";
  if (unreadable(row.OPENTOPUBLIC)) return "open_to_public_unreadable";
  if (unreadable(row.ISEXTANT)) return "extant_unreadable";
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
 * The one word left when `SEASONAL` says yes and `SEASDESC` says nothing.
 *
 * 36 toilet points are flagged seasonal with no description. "Seasonal" is
 * thin, and it is still the difference between a hiker planning around a
 * restroom that may be shut and one who never heard of the possibility. It is
 * also the whole of what the layer said — no dates are invented, and a real
 * description always wins over it.
 */
export const SEASONAL_WITHOUT_DATES_NOTE = "Seasonal";

export function npsSeasonalFlagged(value: unknown): boolean {
  return lower(value) === "yes";
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
 *
 * **The two ways this is wrong are not the same size.** A false positive — a
 * visitor lot whose name happens to hold one of these words — costs coverage:
 * that trailhead publishes no parking, and a reader sees nothing. A false
 * negative publishes the park's maintenance yard as somewhere to leave the
 * car, which is a wrong answer rather than a missing one. So the list errs
 * wide, and the words that over-refuse a little (`government`, `shop`) stay.
 *
 * The tokens come from the layer itself: 121 lot names hold `maintenance`, 101
 * `concession`, 80 `quarters`, 63 `residence`, 40 `employee`, 29 `housing`, 28
 * `dorm`, 15 `barn`, 9 `corral`. `main?t\w*` is deliberate — it covers
 * `maintenance`, `maint`, and the four misspellings the layer carries
 * (`maintenence`, `maintanence`, `maintanance`, and `maitenance`, which drops
 * the first `n` and is why the `n` is optional).
 */
export const NON_PUBLIC_LOT_PATTERN =
  /\b(main?t\w*|employee|employees|staff|residence|residences|residential|administrative|administration|government|utility|shop|warehouse|dorm|dormitor\w*|dormitories|housing|quarters|corral|barn|concession\w*)\b/i;

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
  // The lettered suffixes the layer uses to tell two halves of one lot apart.
  // "Tipsoo Lake Parking B" is a name; a bare "Parking B" is still the row's
  // own label read back to the reader.
  "a",
  "b",
]);

/** The source's own truncation marker, left on a label it cut short. */
export const TRUNCATED_LOT_NAME = /\*\s*$/;

/** Words a title leaves lowercase unless they open or close it. */
const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

/**
 * A shouted name, said at a normal volume.
 *
 * The layer writes most labels in capitals — "PARADISE PARKING (UPPER LOT)" —
 * and a detail sheet that prints them that way is shouting at the reader.
 * Title case is applied here, once, at the boundary where the fact is made,
 * and the untouched original stays in the row's diagnostics.
 *
 * **A name that already carries a lowercase letter is left exactly as it is.**
 * The agency chose that casing, and re-casing it can only lose — "SD (U)
 * Wonsqueak Bike Path Parking" and "ASIS MD North Beach Parking" keep their
 * codes. The known cost is an all-capitals name whose words include an
 * initialism, which comes back title-cased like an ordinary word; no matched
 * lot is one today, and the verbatim original is one field away.
 */
export function titleCaseName(raw: string): string {
  if (/[a-z]/.test(raw)) return raw;
  const tokens = raw.toLowerCase().split(/(\s+)/);
  const words = tokens.filter((token) => token.trim().length > 0).length;
  let index = 0;
  return tokens
    .map((token) => {
      if (token.trim().length === 0) return token;
      index += 1;
      const bare = token.replace(/[^a-z0-9]/g, "");
      if (index > 1 && index < words && SMALL_WORDS.has(bare)) return token;
      return token.replace(/[a-z]+(?:'[a-z]+)*/g, (run) => run.charAt(0).toUpperCase() + run.slice(1));
    })
    .join("");
}

export type LotNoteOutcome =
  | { kind: "note"; text: string; verbatim: string; field: NpsLotNameField }
  | { kind: "refused"; reason: "no_name" | "generic_name" | "truncated_name" };

/**
 * The lot's name as a `parking.location_note`, or the reason it is not one.
 *
 * A truncated label is refused rather than trimmed. "ANCIENT GROVES (NIGHT
 * SHADOWS) NATURE TRAIL PARKI*" is the layer telling us it ran out of
 * characters; cutting the marker off leaves "PARKI", and guessing the rest
 * invents a name. The lot itself still publishes — only its note goes.
 *
 * The published `text` is title-cased; `verbatim` is what the layer holds, and
 * it is what goes into the row's diagnostics. Words are never added, removed
 * or reordered — the only thing that changes is the shouting.
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
  return { kind: "note", text: titleCaseName(name.text), verbatim: name.text, field: name.field };
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
// Lot area — the call site the area contract binds
// ---------------------------------------------------------------------------
//
// `parking-capacity.ts` takes a number and, as its header says, cannot tell a
// good one from a bad one. This is where the number is made, so this is where
// the contract is kept. It has two halves and both move buckets silently.
//
// **Geodesic, not planar.** A Web Mercator area is inflated by 1/cos²(latitude)
// — ×2.00 at 45°N — which through the fitted 0.735 exponent is ×1.66 in cars,
// enough to push most lots a whole bucket high, in the direction that tells a
// hiker there is more parking than there is. What follows is the ground area.
//
// **One lot, net of its holes.** Of the layer's 6,739 usable features 1,006
// carry at least one interior ring — a median, a planted island, a building —
// and reading the gross outline as the area flips 232 buckets. A further 147
// carry more than one *exterior* ring, and two lots either side of a road are
// two lots: the contract is one call per exterior part, never a sum.

/** WGS84, the datum every coordinate in these layers is written in. */
const WGS84_SEMI_MAJOR_M = 6_378_137;
const WGS84_ECCENTRICITY_SQUARED = 0.006_694_379_990_141_32;

/**
 * One lot: an exterior ring and the holes inside it.
 *
 * A feature with two exterior rings yields two of these, and each is asked
 * about separately. Nothing here ever adds two parts together.
 */
export interface PolygonPart {
  exterior: ReadonlyArray<readonly [number, number]>;
  holes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

/**
 * The shoelace area of a ring in a local metre frame — signed, so the sign
 * says which way the ring winds.
 *
 * The frame is an equal-area tangent one: metres east are degrees of longitude
 * times the prime-vertical radius at the origin latitude, metres north are
 * degrees of latitude times the meridional radius there. Both radii come from
 * the WGS84 ellipsoid, so this is the same quantity `ST_Area(geom::geography)`
 * returns rather than a spherical approximation of it. Across a polygon a few
 * hundred metres wide the frame's own error is parts per million; the largest
 * ring in this layer is 500 m across.
 *
 * Every ring of one feature must share an origin, or the exterior and its
 * holes are measured with two different rulers and the subtraction is wrong.
 */
export function signedRingAreaM2(
  ring: ReadonlyArray<readonly [number, number]>,
  origin: SourcePoint
): number {
  const rad = Math.PI / 180;
  const sinLat = Math.sin(origin.lat * rad);
  const w = 1 - WGS84_ECCENTRICITY_SQUARED * sinLat * sinLat;
  const meridional = (WGS84_SEMI_MAJOR_M * (1 - WGS84_ECCENTRICITY_SQUARED)) / Math.pow(w, 1.5);
  const primeVertical = WGS84_SEMI_MAJOR_M / Math.sqrt(w);
  const eastPerDegree = primeVertical * rad * Math.cos(origin.lat * rad);
  const northPerDegree = meridional * rad;

  const points: Array<[number, number]> = [];
  for (const vertex of ring) {
    const lng = Number(vertex[0]);
    const lat = Number(vertex[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push([(lng - origin.lng) * eastPerDegree, (lat - origin.lat) * northPerDegree]);
  }
  if (points.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return twice / 2;
}

/** A ring's ground area, whichever way it winds. */
export function ringAreaM2(
  ring: ReadonlyArray<readonly [number, number]>,
  origin: SourcePoint
): number {
  return Math.abs(signedRingAreaM2(ring, origin));
}

/** The centre of a polygon's box — one origin for every ring of one feature. */
export function ringsOrigin(rings: PolygonRings): SourcePoint | null {
  const bounds = ringsBounds(rings);
  if (bounds === null) return null;
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };
}

/** True when a point falls inside one ring, by the even-odd rule. */
function pointInRing(
  point: readonly [number, number],
  ring: ReadonlyArray<readonly [number, number]>
): boolean {
  let inside = false;
  const [px, py] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
      continue;
    }
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface PolygonPartsResult {
  parts: PolygonPart[];
  /** Interior rings sitting inside no exterior ring, dropped rather than kept. */
  orphanHoles: number;
  /**
   * Rings wound like an exterior and drawn inside one, so read as holes.
   *
   * 21 rings across 18 of the layer's features. Winding is the layer's own
   * statement about which ring is which, and where it contradicts the geometry
   * the geometry wins: a ring inside another ring is ground the outer ring does
   * not cover, whichever way its vertices run.
   */
  demotedHoles: number;
}

/**
 * An ArcGIS ring list split into lots.
 *
 * The layer follows the Esri convention: an exterior ring is drawn clockwise, a
 * hole counter-clockwise. In a frame with longitude east and latitude north,
 * clockwise is a negative shoelace area, so the sign is the whole test. Each
 * hole is then given to the exterior ring that contains it.
 *
 * **A hole inside nothing is dropped, never promoted to a lot of its own.** It
 * is a ring this code cannot place, and the two ways to be wrong about it are
 * not the same size: dropped, it costs a candidate part and the answer comes
 * from the lot next to it; promoted, it adds ground to the total and the answer
 * says there is more parking than there is.
 *
 * **A ring wound like an exterior but drawn inside one is a hole.** The same
 * asymmetry decides it. The layer's winding is a statement about intent, and 21
 * rings in 18 features contradict their own geometry; believing the winding
 * there leaves a building or a planted island counted as parking.
 */
export function polygonParts(rings: PolygonRings): PolygonPartsResult {
  const origin = ringsOrigin(rings);
  if (origin === null) return { parts: [], orphanHoles: 0, demotedHoles: 0 };
  const exteriors: PolygonPart[] = [];
  const holes: Array<ReadonlyArray<readonly [number, number]>> = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    if (signedRingAreaM2(ring, origin) <= 0) exteriors.push({ exterior: ring, holes: [] });
    else holes.push(ring);
  }

  // Largest first, so a nested ring always meets its container before it is
  // asked to contain anything, and the demotion needs no second pass.
  exteriors.sort(
    (a, b) => ringAreaM2(b.exterior, origin) - ringAreaM2(a.exterior, origin)
  );
  const parts: PolygonPart[] = [];
  let demotedHoles = 0;
  for (const candidate of exteriors) {
    const probe = firstFiniteVertex(candidate.exterior);
    const container =
      probe === undefined ? undefined : parts.find((part) => pointInRing(probe, part.exterior));
    if (container === undefined) {
      parts.push(candidate);
      continue;
    }
    // Holes have not been handed out yet, so there is only the ring to move. A
    // hole later found inside a demoted ring is subtracted from the container
    // twice, which reads a lot as smaller than it is — the safe direction.
    (container.holes as Array<ReadonlyArray<readonly [number, number]>>).push(candidate.exterior);
    demotedHoles += 1;
  }

  let orphanHoles = 0;
  for (const hole of holes) {
    const probe = firstFiniteVertex(hole);
    const owner =
      probe === undefined ? undefined : parts.find((part) => pointInRing(probe, part.exterior));
    if (owner === undefined) orphanHoles += 1;
    else (owner.holes as Array<ReadonlyArray<readonly [number, number]>>).push(hole);
  }
  return { parts, orphanHoles, demotedHoles };
}

function firstFiniteVertex(
  ring: ReadonlyArray<readonly [number, number]>
): readonly [number, number] | undefined {
  return ring.find(
    (vertex) => Number.isFinite(Number(vertex[0])) && Number.isFinite(Number(vertex[1]))
  );
}

export interface PartAreas {
  /** The exterior ring's own area. */
  grossM2: number;
  /** The exterior ring less its holes — the only number the calibration takes. */
  netM2: number;
}

/** One part's gross and net ground area, measured in one frame. */
export function partAreasM2(part: PolygonPart, origin: SourcePoint): PartAreas {
  const grossM2 = ringAreaM2(part.exterior, origin);
  let holes = 0;
  for (const hole of part.holes) holes += ringAreaM2(hole, origin);
  return { grossM2, netM2: Math.max(0, grossM2 - holes) };
}

export interface NearestPart {
  index: number;
  distanceM: number;
  part: PolygonPart;
}

/**
 * The part of a feature the trailhead is nearest, which is the lot it means.
 *
 * A multi-part feature is not one lot, and the question of which part answers
 * is not a matter of precision but of identity: the driver parks in the one in
 * front of them. Distance is to the part's edge and zero inside it, holes
 * included, so a trailhead standing in a lot's planted island is not "in" it.
 */
export function nearestExteriorPart(
  point: SourcePoint,
  parts: readonly PolygonPart[]
): NearestPart | null {
  let best: NearestPart | null = null;
  parts.forEach((part, index) => {
    const distanceM = metresToPolygon(point, [part.exterior, ...part.holes]);
    if (distanceM === null) return;
    if (best === null || distanceM < best.distanceM) best = { index, distanceM, part };
  });
  return best;
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
  /**
   * A lot's rings, parsed once by the reader that boxed them.
   *
   * Only the parking join carries them, and only because the capacity range is
   * read off the lot's own ground area. A toilet POI is a point and has none.
   */
  rings?: PolygonRings;
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
  /**
   * The fixture the POI's own name gave away, when `POITYPE` did not.
   *
   * Null on every row whose type was already specific, and on every row whose
   * name says nothing. Where it is set, the published `type` came from the
   * name rather than the type field, and this is the evidence for it.
   */
  type_from_poi_name: TrailheadBathroomType | null;
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
    // A specific type is never overruled by a name. The name only speaks where
    // the type said `unspecified` and the same agency wrote the fixture into
    // the next field along: "Kautz Creek Vault Toilet", typed `Restroom`.
    const fromName = type === "unspecified" ? toiletTypeFromName(candidate.row.POINAME) : null;
    const facts: NpsBathroomFacts = {
      status: npsSourcedValue("present" as const, source),
      type: npsSourcedValue(fromName ?? type, source),
    };
    // A described season beats a flagged one; a flagged one beats silence.
    const seasonNote =
      npsSeasonNote(candidate.row.SEASDESC) ??
      (npsSeasonalFlagged(candidate.row.SEASONAL) ? SEASONAL_WITHOUT_DATES_NOTE : null);
    if (seasonNote !== null) facts.season_note = npsSourcedValue(seasonNote, source);
    return {
      outcome: {
        facts,
        diagnostics: {
          distance_m: distance,
          poi_type: poiType,
          type_from_poi_name: fromName,
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
  capacity_range?: SourcedValue<TrailheadParkingCapacityRange>;
  location_note?: SourcedValue<string>;
}

/**
 * Whether a run publishes the capacity range it computes.
 *
 * **Off, and off for a reason a date will not fix.** The calibration's own
 * held-out numbers come from Forest Service prose joined to OpenStreetMap lot
 * polygons, and the re-validation this wiring was supposed to run — the 137
 * stated capacities in `fs-page-sections-full.jsonl`, scored against the frozen
 * thresholds — cannot be run without pulling OSM again: **not one of the 137
 * pages has an NPS lot within 200 m**, because Forest Service trailheads are
 * not in national parks. So the buckets this join is about to publish rest on
 * evidence gathered somewhere else entirely, over a population the calibration
 * doc itself names as the most likely reason its numbers would be wrong in
 * practice: "No NPS lot carries a capacity, so this is untested."
 *
 * The gate that clears it is a person's, not a script's:
 * `docs/trailheads/data/nps-capacity-spotcheck.md` is a stratified sample of
 * sixty lots with a maps link on each row, and the apply is gated on someone
 * reading it against imagery at 80% correct-or-adjacent. Pass
 * `emitCapacityRange: true` — `--capacity-range` on the normalizer — once that
 * has happened, and flip this default in the same change.
 */
export const CAPACITY_RANGE_EMISSION_DEFAULT = false;

export interface NpsParkingOptions {
  /** Publish the computed range. Default `CAPACITY_RANGE_EMISSION_DEFAULT`. */
  emitCapacityRange?: boolean;
}

/**
 * Everything the area computation found, whether or not a range was published.
 *
 * Written to the row's diagnostics and never imported, which is what lets it
 * hold the fitted car count: the curve is a centre line through a cloud a full
 * order of magnitude wide, so the number is evidence for a person checking a
 * bucket against imagery and is not a fact about the trailhead. It is also the
 * only place the gross area survives, and gross against net is the difference
 * that flips 232 of the layer's buckets.
 */
export interface NpsLotAreaDiagnostics {
  /** Which exterior part answered, counting from zero. */
  part_index: number;
  parts: number;
  /** Metres from the trailhead to that part, zero inside it. */
  part_distance_m: number;
  gross_area_m2: number;
  net_area_m2: number;
  /** Interior rings this feature carries, across every part. */
  holes: number;
  /** Interior rings inside no exterior ring, dropped rather than counted. */
  orphan_holes: number;
  /** Exterior-wound rings drawn inside another, read as holes. */
  demoted_holes: number;
  /** The fitted curve at the net area. Diagnostic only — never published. */
  fitted_cars: number;
  capacity_range: TrailheadParkingCapacityRange | null;
  /** Why no range, when there is none: below the floor, above the cap, or off. */
  capacity_range_withheld: string | null;
}

/**
 * The lot's area as a capacity range, plus everything the measurement saw.
 *
 * The area contract in one place: split the feature into exterior parts, take
 * the part the trailhead is nearest, subtract that part's holes, and hand the
 * geodesic result to `estimateCapacityRange`. A feature with no usable ring
 * makes no claim; so does one whose part is under the three-car floor or over
 * the fifty-thousand-square-metre cap, and the withheld reason says which.
 */
export function npsLotCapacity(
  point: SourcePoint,
  rings: PolygonRings | undefined
): NpsLotAreaDiagnostics | null {
  if (rings === undefined) return null;
  const origin = ringsOrigin(rings);
  if (origin === null) return null;
  const { parts, orphanHoles, demotedHoles } = polygonParts(rings);
  const nearest = nearestExteriorPart(point, parts);
  if (nearest === null) return null;
  const areas = partAreasM2(nearest.part, origin);
  const range = estimateCapacityRange(areas.netM2);
  const withheld =
    range !== null
      ? null
      : areas.netM2 < PARKING_CAPACITY_CALIBRATION.minLotAreaM2
        ? "below_floor"
        : "above_cap";
  return {
    part_index: nearest.index,
    parts: parts.length,
    part_distance_m: Number(nearest.distanceM.toFixed(1)),
    gross_area_m2: Number(areas.grossM2.toFixed(1)),
    net_area_m2: Number(areas.netM2.toFixed(1)),
    holes: parts.reduce((total, part) => total + part.holes.length, 0),
    orphan_holes: orphanHoles,
    demoted_holes: demotedHoles,
    fitted_cars: Number(fittedCapacityCurve(areas.netM2).toFixed(2)),
    capacity_range: range,
    capacity_range_withheld: withheld,
  };
}

export interface NpsParkingDiagnostics {
  distance_m: number;
  /** True where the trailhead stands inside the lot polygon. */
  inside_lot: boolean;
  lot_id: string | null;
  /** The name exactly as the layer holds it, before the published note is cased. */
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
  /**
   * What the lot's own ground area came to, and what it was read as.
   *
   * Null where the feature carried no usable ring. Present even when no range
   * was published — a lot refused for being under the three-car floor is the
   * gate working, and the areas are what say so.
   */
  area: NpsLotAreaDiagnostics | null;
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
 * **The capacity here is a range and can never be anything else.**
 * research-parking.md §2.5 offered polygon area as a proxy at 30 m² a space and
 * admitted the ratio had never been calibrated. It has been now — see
 * `parking-capacity.ts` and docs/parking-capacity-calibration.md, which found
 * 30 m² about twice as dense as a real trailhead lot — and what the calibration
 * yields is a bucket, published in `capacity_range` beside `capacity_vehicles`
 * and never in it. A fitted range written where counted numbers live would read
 * exactly like a number somebody counted. `capacity_vehicles` is not merely
 * absent from what this returns; the importer refuses an NPS row carrying one
 * by name.
 *
 * The area behind the bucket obeys the contract in `npsLotCapacity`: the
 * nearest exterior part, net of its holes, measured on the ellipsoid. Whether
 * the bucket is *published* is a separate question, and its default answer is
 * no — see `CAPACITY_RANGE_EMISSION_DEFAULT`.
 */
export function npsParkingFacts(
  candidates: readonly NpsCandidate[],
  source: NpsSource,
  trailhead: SourcePoint,
  options: NpsParkingOptions = {}
): NpsParkingResult {
  const emitCapacityRange = options.emitCapacityRange ?? CAPACITY_RANGE_EMISSION_DEFAULT;
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
    const area = npsLotCapacity(trailhead, candidate.rings);
    if (area !== null && area.capacity_range !== null) {
      if (emitCapacityRange) facts.capacity_range = npsSourcedValue(area.capacity_range, source);
      else area.capacity_range_withheld = "emission_disabled";
    }
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
          area,
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
