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

export interface SpotcheckRow {
  unit_code: string | null;
  unit_name: string | null;
  lot_name: string | null;
  lot_id: string | null;
  capacity_range: TrailheadParkingCapacityRange;
  gross_area_m2: number;
  net_area_m2: number;
  part_index: number;
  parts: number;
  holes: number;
  fitted_cars: number;
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

/** The area-weighted centre of a ring, which is where the imagery should open. */
export function ringCentroid(
  ring: ReadonlyArray<readonly [number, number]>
): { lat: number; lng: number } | null {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i].map(Number) as [number, number];
    const [x2, y2] = ring[(i + 1) % ring.length].map(Number) as [number, number];
    if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) continue;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (twiceArea === 0) return null;
  return { lat: y / (3 * twiceArea), lng: x / (3 * twiceArea) };
}

/** Google Maps, opened on satellite imagery at about a lot's width. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@${lat.toFixed(6)},${lng.toFixed(6)},150m/data=!3m1!1e3`;
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
    parts.forEach((part: PolygonPart, index: number) => {
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
      candidates.push({
        unit_code: typeof row.UNITCODE === "string" ? row.UNITCODE : null,
        unit_name: typeof row.UNITNAME === "string" ? row.UNITNAME : null,
        lot_name: name === null ? null : titleCaseName(name.text),
        lot_id: lotId,
        capacity_range: range,
        gross_area_m2: Number(areas.grossM2.toFixed(1)),
        net_area_m2: Number(areas.netM2.toFixed(1)),
        part_index: index,
        parts: parts.length,
        holes: part.holes.length,
        fitted_cars: Number(fittedCapacityCurve(areas.netM2).toFixed(1)),
        lat: Number(centre.lat.toFixed(6)),
        lng: Number(centre.lng.toFixed(6)),
        maps_url: mapsUrl(centre.lat, centre.lng),
        rank: stableRank(`${lotId ?? "?"}#${index}`),
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
    // Two passes: the first holds every park to its share, the second fills
    // whatever the cap left short rather than shipping a thin stratum.
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

/** The same sixty rows as a table somebody can read down. */
export function renderMarkdown(sample: readonly SpotcheckRow[], total: number): string {
  const lines: string[] = [];
  lines.push("# NPS parking capacity — spot-check sample");
  lines.push("");
  lines.push(
    "Sixty National Park Service lots, drawn from the " +
      `${total.toLocaleString("en-US")} the pipeline would answer for, with the capacity range ` +
      "this code reads off each one's mapped ground area."
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
  lines.push(
    "Open each maps link, count what the lot holds, and mark the range correct, " +
      "adjacent (one bucket out) or wrong. The gate is **80% correct-or-adjacent " +
      "with a few exact hits among the `100_plus` rows** — that bucket has no " +
      "positive validation of any kind today. Then flip " +
      "`CAPACITY_RANGE_EMISSION_DEFAULT` in `nps-facts-utils.ts`."
  );
  lines.push("");
  lines.push(
    "Areas are geodesic and net of interior rings, measured on the one exterior " +
      "part named in `part`. `cars` is the fitted curve's centre line — it is here " +
      "as evidence for the bucket and is published nowhere."
  );
  lines.push("");
  lines.push("| # | Park | Lot | Range | Net m² | Gross m² | Part | cars | Imagery |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  sample.forEach((row, index) => {
    const part = row.parts > 1 ? `${row.part_index + 1} of ${row.parts}` : "1";
    const holes = row.holes > 0 ? ` (${row.holes} hole${row.holes > 1 ? "s" : ""})` : "";
    lines.push(
      `| ${index + 1} | ${row.unit_code ?? "—"} | ${row.lot_name ?? "(unnamed)"} | \`${row.capacity_range}\` | ` +
        `${row.net_area_m2.toLocaleString("en-US")} | ${row.gross_area_m2.toLocaleString("en-US")} | ` +
        `${part}${holes} | ${row.fitted_cars} | [map](${row.maps_url}) |`
    );
  });
  lines.push("");
  return lines.join("\n");
}

export function usage(): string {
  return [
    "Usage:",
    "  tsx src/nps-capacity-spotcheck.ts --data-dir=/path/docs/trailheads/data",
    "",
    "Options:",
    "  --data-dir=DIR   directory holding the raw NPS pull (required)",
    "  --parking=FILE   override <data-dir>/raw/nps-public-parking-lots.jsonl",
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

  writeFile(outPath, sample.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFile(markdownPath, renderMarkdown(sample, candidates.length));

  logger.log(`Lots read:            ${rows.length}`);
  logger.log(`Parts with a range:   ${candidates.length}`);
  for (const range of CAPACITY_RANGES) {
    const pool = candidates.filter((row) => row.capacity_range === range).length;
    const drawn = sample.filter((row) => row.capacity_range === range).length;
    logger.log(`  ${range.padEnd(10)} ${String(pool).padStart(6)} available, ${drawn} sampled`);
  }
  logger.log(`Sample written:       ${sample.length}`);
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
