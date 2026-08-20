// A stratified sample of National Park Service parking lots, with the capacity
// range this code reads off each one, for a person to check against imagery.
//
//   npm run spotcheck:nps-capacity -- --data-dir=/path/to/peaks/docs/trailheads/data
//
// **This file is the gate.** The calibration in `parking-capacity.ts` was fitted
// on OpenStreetMap lots in Forest Service country and validated against Forest
// Service prose. Its consumer is a national-park layer, no NPS lot carries a
// capacity, and the re-validation that was meant to close that gap cannot run:
// **not one of the 137 pages with a stated capacity has an NPS lot within
// 200 m** — the nearest is a kilometre away and the median 57 km — because
// Forest Service trailheads are not in national parks. There is no OSM-free
// path from that evidence to this population.
//
// So the evidence has to come from somewhere else, and the somewhere else is a
// person with satellite imagery. Sixty lots, stratified so the thin buckets are
// represented rather than drowned by the common ones, each with a maps link at
// the part this code measured. `CAPACITY_RANGE_EMISSION_DEFAULT` stays false
// until someone has read this file and found the calls correct-or-adjacent at
// 80% or better, with a few exact hits in the top stratum — the one bucket the
// calibration has no positive validation for at all.
//
// The sample is deterministic: the same layer file gives the same sixty lots,
// so a second reviewer checks the same rows as the first, and a data refresh
// that moves the sample says so by moving it.

import fs from "fs";
import path from "path";

import {
  npsFeatureAnomaly,
  npsLotName,
  isNonPublicLotName,
  partAreasM2,
  polygonParts,
  ringsBounds,
  titleCaseName,
  type PolygonPart,
  type PolygonRings,
} from "./nps-facts-utils";
import {
  CAPACITY_RANGES,
  estimateCapacityRange,
  fittedCapacityCurve,
  type TrailheadParkingCapacityRange,
} from "./parking-capacity";

/**
 * How many lots per bucket.
 *
 * The two top buckets get half again as many because they are where being
 * wrong costs most and where the calibration is weakest: the 100-car edge has
 * the widest bootstrap interval of the four (7,490 - 10,475 m²), and the
 * Forest Service prose set contains not one correct `100_plus` call in either
 * direction.
 */
export const SPOTCHECK_STRATA: Readonly<Record<TrailheadParkingCapacityRange, number>> = {
  under_10: 10,
  "10_to_25": 10,
  "25_to_50": 10,
  "50_to_100": 15,
  "100_plus": 15,
};

/** At most this many rows from one park, so the sample is not one big park. */
export const SPOTCHECK_MAX_PER_UNIT = 2;

/**
 * A polygon shaped like a road rather than a lot.
 *
 * The layer draws some access roads, ferry approaches and parking *loops* as
 * `parking` polygons. Area says nothing useful about those: a 200 m strip of
 * carriageway covers as much ground as a 40-car lot and holds nobody, so the
 * curve reads them high — the over-claim direction, and the one that strands a
 * driver. There is no fix inside an area-based method, which is exactly why
 * these rows have to be visible in the gate rather than quietly scored.
 *
 * The shape test is the isoperimetric quotient in reverse: perimeter² over
 * 16·area is 1 for a square and grows with elongation. Above 8 the polygon is
 * at least eight times longer than it is wide.
 */
export const ROAD_SHAPE_ELONGATION = 8;
export const ROAD_SHAPE_MIN_AREA_M2 = 1_500;
export const ROAD_NAME_PATTERN = /\b(road|route|drive|loop|parkway)\b/i;

export interface SpotcheckRow {
  unit_code: string | null;
  unit_name: string | null;
  lot_name: string | null;
  lot_id: string | null;
  capacity_range: TrailheadParkingCapacityRange;
  gross_area_m2: number;
  net_area_m2: number;
  /** Position when the parts were ordered largest first — 0 is the biggest. */
  area_rank: number;
  /** Where this part's exterior ring sits in the feature's own ring list. */
  source_ring_index: number;
  parts: number;
  holes: number;
  fitted_cars: number;
  /**
   * The polygon is shaped like a road, or named like one.
   *
   * **A `road_suspect` row marked correct-or-adjacent does not count toward the
   * pass bar.** Scoring them would let the sample pass on the strength of rows
   * nobody should be publishing a capacity for in the first place.
   */
  road_suspect: boolean;
  /** Which test flagged it: shape, name, or both. */
  road_suspect_reason: string | null;
  lat: number;
  lng: number;
  maps_url: string;
}

/**
 * A stable order that does not follow the file's own.
 *
 * Taking the first ten of each bucket in file order would sample whichever
 * park the layer happens to list first. This is the same shuffle every run, so
 * two reviewers read the same sixty rows.
 */
export function stableRank(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * The area-weighted centre of a ring, which is where the imagery should open.
 *
 * **Measured from the ring's first vertex, not from the null island.** The
 * shoelace cross terms at real coordinates are of order 121 × 45, while a
 * parking lot's signed area in square degrees is of order 1e-7 — eleven digits
 * of a double's sixteen go to cancellation, and the answer lands metres from
 * the lot. Shifting the origin onto the ring keeps every term the same size as
 * the polygon, and the offset goes back on at the end. On a 60 m square this
 * is the difference between the middle of the lot and 2.5 m outside it.
 */
export function ringCentroid(
  ring: ReadonlyArray<readonly [number, number]>
): { lat: number; lng: number } | null {
  const first = ring.find(
    (vertex) => Number.isFinite(Number(vertex[0])) && Number.isFinite(Number(vertex[1]))
  );
  if (first === undefined) return null;
  const originLng = Number(first[0]);
  const originLat = Number(first[1]);
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const x1 = Number(a[0]) - originLng;
    const y1 = Number(a[1]) - originLat;
    const x2 = Number(b[0]) - originLng;
    const y2 = Number(b[1]) - originLat;
    if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) continue;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (twiceArea === 0) return null;
  return {
    lat: originLat + y / (3 * twiceArea),
    lng: originLng + x / (3 * twiceArea),
  };
}

/** Google Maps, opened on satellite imagery at about a lot's width. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@${lat.toFixed(6)},${lng.toFixed(6)},150m/data=!3m1!1e3`;
}

/** A ring's perimeter, in the same local metre frame the area is measured in. */
export function ringPerimeterM(
  ring: ReadonlyArray<readonly [number, number]>,
  origin: { lat: number; lng: number }
): number {
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    total += metresBetween(ring[i], ring[(i + 1) % ring.length], origin);
  }
  return total;
}

function metresBetween(
  a: readonly [number, number],
  b: readonly [number, number],
  origin: { lat: number; lng: number }
): number {
  const rad = Math.PI / 180;
  const eastPerDegree = 111_320 * Math.cos(origin.lat * rad);
  const dx = (Number(b[0]) - Number(a[0])) * eastPerDegree;
  const dy = (Number(b[1]) - Number(a[1])) * 110_574;
  return Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : 0;
}

/**
 * Whether this part is a road wearing a lot's clothes, and which test said so.
 *
 * **The area here is the exterior ring's own — gross, not net.** The perimeter
 * belongs to that ring, so the shape ratio has to be built from the same
 * outline: dividing an exterior perimeter by an area with the holes taken out
 * makes any lot with a planted island look like a road. Bison Basin's
 * campground loop is 24,362 m² of outline around 7,222 m² of surface, and
 * against the net figure it flagged as a carriageway.
 */
export function roadSuspicion(
  grossAreaM2: number,
  perimeterM: number,
  lotName: string | null
): { suspect: boolean; reason: string | null } {
  const elongation = grossAreaM2 > 0 ? (perimeterM * perimeterM) / (16 * grossAreaM2) : 0;
  const byShape = grossAreaM2 > ROAD_SHAPE_MIN_AREA_M2 && elongation > ROAD_SHAPE_ELONGATION;
  const byName = lotName !== null && ROAD_NAME_PATTERN.test(lotName);
  if (byShape && byName) return { suspect: true, reason: "shape_and_name" };
  if (byShape) return { suspect: true, reason: "shape" };
  if (byName) return { suspect: true, reason: "name" };
  return { suspect: false, reason: null };
}

interface Candidate extends SpotcheckRow {
  rank: number;
}

/**
 * Every (lot, part) pair the pipeline would answer for, with its bucket.
 *
 * The unit is the part rather than the feature, because the part is what
 * `estimateCapacityRange` is called on. Every gate the join applies is applied
 * here too — an anomalous lot, a staff lot, a part under the floor or over the
 * cap — so a reviewer is checking what would be published and nothing else.
 */
export function spotcheckCandidates(rows: Iterable<Record<string, unknown>>): Candidate[] {
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const geometry = row._geometry as { rings?: unknown } | undefined;
    const rings = geometry?.rings;
    if (!Array.isArray(rings) || rings.length === 0) continue;
    const bounds = ringsBounds(rings as PolygonRings);
    if (bounds === null) continue;
    if (npsFeatureAnomaly(row) !== null) continue;
    const name = npsLotName(row);
    if (isNonPublicLotName(name?.text)) continue;

    const origin = {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lng: (bounds.minLng + bounds.maxLng) / 2,
    };
    const { parts } = polygonParts(rings as PolygonRings);
    parts.forEach((part: PolygonPart, areaRank: number) => {
      const areas = partAreasM2(part, origin);
      const range = estimateCapacityRange(areas.netM2);
      if (range === null) return;
      const centre = ringCentroid(part.exterior);
      if (centre === null) return;
      const lotId =
        typeof row.GEOMETRYID === "string" && row.GEOMETRYID.trim().length > 0
          ? row.GEOMETRYID.trim()
          : row.OBJECTID === undefined || row.OBJECTID === null
            ? null
            : String(row.OBJECTID);
      const lotName = name === null ? null : titleCaseName(name.text);
      const road = roadSuspicion(
        areas.grossM2,
        ringPerimeterM(part.exterior, origin),
        lotName
      );
      candidates.push({
        unit_code: typeof row.UNITCODE === "string" ? row.UNITCODE : null,
        unit_name: typeof row.UNITNAME === "string" ? row.UNITNAME : null,
        lot_name: lotName,
        lot_id: lotId,
        capacity_range: range,
        gross_area_m2: Number(areas.grossM2.toFixed(1)),
        net_area_m2: Number(areas.netM2.toFixed(1)),
        area_rank: areaRank,
        source_ring_index: part.sourceRingIndex,
        parts: parts.length,
        holes: part.holes.length,
        fitted_cars: Number(fittedCapacityCurve(areas.netM2).toFixed(1)),
        road_suspect: road.suspect,
        road_suspect_reason: road.reason,
        lat: Number(centre.lat.toFixed(6)),
        lng: Number(centre.lng.toFixed(6)),
        maps_url: mapsUrl(centre.lat, centre.lng),
        rank: stableRank(`${lotId ?? "?"}#${part.sourceRingIndex}`),
      });
    });
  }
  return candidates;
}

/** The sixty, drawn bucket by bucket and spread across parks. */
export function drawSample(candidates: readonly Candidate[]): SpotcheckRow[] {
  const sample: SpotcheckRow[] = [];
  for (const range of CAPACITY_RANGES) {
    const wanted = SPOTCHECK_STRATA[range];
    const pool = candidates.filter((row) => row.capacity_range === range).sort((a, b) => a.rank - b.rank);
    const perUnit = new Map<string, number>();
    const taken: Candidate[] = [];
    // Two passes over the same pool. The first takes at most two rows per park,
    // which spreads the stratum; the second lifts that cap and fills whatever
    // is still short, because a thin stratum is worse than a lopsided one. A
    // park's count carries across both passes, so the second pass tops up from
    // the parks with rows left rather than restarting the tally.
    for (const cap of [SPOTCHECK_MAX_PER_UNIT, Number.POSITIVE_INFINITY]) {
      for (const row of pool) {
        if (taken.length >= wanted) break;
        if (taken.includes(row)) continue;
        const unit = row.unit_code ?? "?";
        if ((perUnit.get(unit) ?? 0) >= cap) continue;
        perUnit.set(unit, (perUnit.get(unit) ?? 0) + 1);
        taken.push(row);
      }
    }
    for (const row of taken) {
      const { rank: _rank, ...published } = row;
      void _rank;
      sample.push(published);
    }
  }
  return sample;
}

function partCell(row: SpotcheckRow): string {
  // The rank is a size ordering this code imposed; the ring index is the
  // layer's own numbering and the only one worth quoting back to anybody.
  const rank = row.parts > 1 ? `${row.area_rank + 1} of ${row.parts}` : "1";
  const holes = row.holes > 0 ? `, ${row.holes} hole${row.holes > 1 ? "s" : ""}` : "";
  return `${rank} (ring ${row.source_ring_index}${holes})`;
}

function tableRow(row: SpotcheckRow, index: number): string {
  const flag = row.road_suspect ? " **road?**" : "";
  return (
    `| ${index} | ${row.unit_code ?? "\u2014"} | ${row.lot_name ?? "(unnamed)"}${flag} | ` +
    `\`${row.capacity_range}\` | ${row.net_area_m2.toLocaleString("en-US")} | ` +
    `${row.gross_area_m2.toLocaleString("en-US")} | ${partCell(row)} | ${row.fitted_cars} | ` +
    `[map](${row.maps_url}) |`
  );
}

const TABLE_HEAD = [
  "| # | Park | Lot | Range | Net m\u00b2 | Gross m\u00b2 | Part | cars | Imagery |",
  "|---|---|---|---|---|---|---|---|---|",
];

/** The sample and the publishing lots, as tables somebody can read down. */
export function renderMarkdown(
  sample: readonly SpotcheckRow[],
  total: number,
  publishing: readonly SpotcheckRow[] = []
): string {
  const lines: string[] = [];
  lines.push("# NPS parking capacity \u2014 spot-check sample");
  lines.push("");
  lines.push(
    "Sixty National Park Service lots, drawn from the " +
      `${total.toLocaleString("en-US")} the pipeline would answer for, with the capacity range ` +
      "this code reads off each one's mapped ground area. Below them, every lot " +
      "that would actually publish a range today."
  );
  lines.push("");
  lines.push(
    "**Read this before the ranges ship.** The calibration behind them was " +
      "fitted on OpenStreetMap lots in Forest Service country and checked against " +
      "Forest Service prose. Its consumer is this layer, no NPS lot carries a " +
      "capacity, and the held-out re-validation cannot reach here: none of the 137 " +
      "Forest Service pages with a stated capacity has an NPS lot within 200 m. " +
      "So the evidence for this population is imagery, and this file is where it " +
      "gets gathered."
  );
  lines.push("");
  lines.push("## How to score it");
  lines.push("");
  lines.push(
    "Open each maps link, count what the lot holds, and mark the range correct, " +
      "adjacent (one bucket out) or wrong. The bar is **80% correct-or-adjacent, " +
      "with a few exact hits among the `100_plus` rows** \u2014 that bucket has no " +
      "positive validation of any kind today, in either direction."
  );
  lines.push("");
  lines.push(
    "**A row marked `road?` does not count toward the bar.** Those polygons are " +
      `shaped like a road (over ${ROAD_SHAPE_ELONGATION}\u00d7 longer than wide, above ` +
      `${ROAD_SHAPE_MIN_AREA_M2.toLocaleString("en-US")} m\u00b2) or named like one, and the ` +
      "layer really does draw some access roads, ferry approaches and parking " +
      "loops as parking polygons. Area says nothing useful about a carriageway: " +
      "200 m of one covers as much ground as a 40-car lot and holds nobody, so the " +
      "curve reads it high \u2014 the over-claim direction. No area-based method " +
      "recovers that, so scoring these as correct would let the sample pass on the " +
      "strength of rows nothing should publish a capacity for at all. Score them, " +
      "write down what they are, and leave them out of the fraction. If many are " +
      "wrong, the fix is a shape filter in the pipeline, not a better curve."
  );
  lines.push("");
  lines.push(
    "Areas are geodesic and net of interior rings, measured on the one exterior " +
      "part named in `part` \u2014 the rank is by size, the ring number is the " +
      "layer's own. `cars` is the fitted curve's centre line: evidence for the " +
      "bucket, published nowhere."
  );
  lines.push("");
  lines.push(
    "When it passes, flip `CAPACITY_RANGE_EMISSION_DEFAULT` in " +
      "`nps-facts-utils.ts`. **That is a one-way door for the data** \u2014 the " +
      "importer only ever sets a leaf, so a range that has been applied cannot be " +
      "withdrawn by re-running with the gate shut."
  );
  lines.push("");

  const suspects = sample.filter((row) => row.road_suspect).length;
  lines.push("## The stratified sixty");
  lines.push("");
  lines.push(
    `${sample.length} rows, ${suspects} flagged \`road?\` and excluded from the bar, ` +
      `leaving ${sample.length - suspects} that count.`
  );
  lines.push("");
  lines.push(...TABLE_HEAD);
  sample.forEach((row, index) => lines.push(tableRow(row, index + 1)));
  lines.push("");

  lines.push("## Every lot that would publish today");
  lines.push("");
  if (publishing.length === 0) {
    lines.push(
      "None listed \u2014 `nps-trailhead-facts.jsonl` was not beside this file, or " +
        "held no parking rows. Run the normalizer, then this command again."
    );
  } else {
    const flagged = publishing.filter((row) => row.road_suspect).length;
    lines.push(
      `The ${publishing.length} lots the join actually matched to a Peaks trailhead. ` +
        "The sixty above test the calibration across the layer; these are the rows " +
        "that would appear on a detail sheet the day the gate opens, so **every one " +
        "of them wants looking at**, not sampling." +
        (flagged > 0
          ? ` ${flagged} carry the \`road?\` flag.`
          : " None carries the `road?` flag.")
    );
    lines.push("");
    lines.push(...TABLE_HEAD);
    publishing.forEach((row, index) => lines.push(tableRow(row, index + 1)));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * The lots that would actually publish, in the order the facts file holds them.
 *
 * A stratified sample tests the calibration across the layer; it does not test
 * the rows a reader would see. Those are the lots the 150 m join matched to a
 * Peaks trailhead — a few dozen, so there is no reason to sample them at all.
 * They are found by the lot id and part the normalizer recorded, so this table
 * is the same measurement the pipeline made and not a second one.
 */
export function publishingRows(
  candidates: readonly SpotcheckRow[],
  factsJsonl: string
): SpotcheckRow[] {
  const byPart = new Map<string, SpotcheckRow>();
  for (const row of candidates) byPart.set(`${row.lot_id ?? "?"}#${row.area_rank}`, row);
  const found: SpotcheckRow[] = [];
  const seen = new Set<string>();
  for (const line of factsJsonl.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const diagnostics = parsed.diagnostics as { parking?: Record<string, unknown> } | undefined;
    const parking = diagnostics?.parking;
    if (parking === undefined) continue;
    const area = parking.area as { area_rank?: unknown } | null | undefined;
    if (area === null || area === undefined) continue;
    const key = `${parking.lot_id ?? "?"}#${area.area_rank ?? 0}`;
    if (seen.has(key)) continue;
    const match = byPart.get(key);
    if (match === undefined) continue;
    seen.add(key);
    found.push(match);
  }
  return found;
}

export function usage(): string {
  return [
    "Usage:",
    "  tsx src/nps-capacity-spotcheck.ts --data-dir=/path/docs/trailheads/data",
    "",
    "Options:",
    "  --data-dir=DIR   directory holding the raw NPS pull (required)",
    "  --parking=FILE   override <data-dir>/raw/nps-public-parking-lots.jsonl",
    "  --facts=FILE     override <data-dir>/nps-trailhead-facts.jsonl, which names",
    "                   the lots that would actually publish (missing is not fatal)",
    "  --out=FILE       override <data-dir>/nps-capacity-spotcheck.jsonl",
    "  --help           print this and exit",
  ].join("\n");
}

export function main(argv: string[], deps: {
  readFile?: (filePath: string) => string;
  writeFile?: (filePath: string, contents: string) => void;
  console?: Pick<Console, "log">;
} = {}): SpotcheckRow[] {
  const logger = deps.console ?? console;
  const readFile = deps.readFile ?? ((filePath: string) => fs.readFileSync(filePath, "utf8"));
  const writeFile =
    deps.writeFile ??
    ((filePath: string, contents: string) => fs.writeFileSync(filePath, contents, "utf8"));
  const text = (flag: string): string | null => {
    const raw = argv.find((a) => a.startsWith(`--${flag}=`));
    return raw ? raw.slice(flag.length + 3) : null;
  };
  const dataDir = text("data-dir");
  if (!dataDir) throw new Error(`${usage()}\n\n--data-dir is required`);
  const parkingPath = text("parking") ?? path.join(dataDir, "raw", "nps-public-parking-lots.jsonl");
  const outPath = text("out") ?? path.join(dataDir, "nps-capacity-spotcheck.jsonl");
  const markdownPath = outPath.replace(/\.jsonl$/, ".md");

  const rows: Array<Record<string, unknown>> = [];
  for (const line of readFile(parkingPath).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      rows.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // A malformed line is one lot missing from a sample, not a failed run.
    }
  }
  const candidates = spotcheckCandidates(rows);
  const sample = drawSample(candidates);

  // The facts file is optional: this command is about the layer, and a run
  // before the normalizer has one is still a useful sample. The gate is not
  // complete without it, and the markdown says so where the table would be.
  const factsPath = text("facts") ?? path.join(dataDir, "nps-trailhead-facts.jsonl");
  let publishing: SpotcheckRow[] = [];
  try {
    publishing = publishingRows(candidates, readFile(factsPath));
  } catch {
    publishing = [];
  }

  writeFile(outPath, sample.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFile(markdownPath, renderMarkdown(sample, candidates.length, publishing));

  logger.log(`Lots read:            ${rows.length}`);
  logger.log(`Parts with a range:   ${candidates.length}`);
  for (const range of CAPACITY_RANGES) {
    const pool = candidates.filter((row) => row.capacity_range === range).length;
    const drawn = sample.filter((row) => row.capacity_range === range).length;
    logger.log(`  ${range.padEnd(10)} ${String(pool).padStart(6)} available, ${drawn} sampled`);
  }
  logger.log(`Road-suspect parts:   ${candidates.filter((row) => row.road_suspect).length}`);
  logger.log(`Sample written:       ${sample.length}`);
  logger.log(`  of those, road?:    ${sample.filter((row) => row.road_suspect).length}`);
  logger.log(`Publishing lots:      ${publishing.length}`);
  logger.log(`  of those, road?:    ${publishing.filter((row) => row.road_suspect).length}`);
  logger.log(`  ${outPath}`);
  logger.log(`  ${markdownPath}`);
  return sample;
}

function isDirectRun(scriptPath: string | undefined): boolean {
  return /(?:^|[/\\])nps-capacity-spotcheck\.(?:ts|js)$/.test(scriptPath ?? "");
}

if (isDirectRun(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }
  main(argv);
}
