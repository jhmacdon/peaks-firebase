// Normalize the National Park Service POI and parking-lot pulls into one
// per-trailhead facts file.
//
//   npm run normalize:nps-trailhead-facts -- --data-dir=/path/to/peaks/docs/trailheads/data
//
// Two spatial joins against the catalog's trailheads: the nearest usable toilet
// POI within 150 m becomes a bathroom block, the nearest usable parking polygon
// within 150 m becomes a parking block. One row per trailhead that got at least
// one of them, keyed by destination id, shaped so the import is a copy rather
// than a translation.
//
// The database is read once, read-only, for the trailheads themselves: id, name
// and coordinates. Nothing is written to it here.
//
// Two rules govern the whole pipeline, both from the research this implements:
//
//   - **Presence only.** NPS records the restrooms it has mapped and says
//     nothing about the ones it has not (research-bathrooms.md §3.2). Nothing
//     here writes `absent`, and a trailhead with no NPS feature near it gets no
//     row at all rather than a row that reads like a survey.
//   - **Capacity is a range, or it is nothing.** research-parking.md §2.5 offered
//     polygon area as a proxy at 30 m² a space and said in the same paragraph
//     that the ratio was never calibrated. It has been now, and it yields a
//     bucket rather than a number: `parking.capacity_range`, read off the lot's
//     own ground area by the contract in `npsLotCapacity`. No count is emitted
//     from an area, ever, and the buckets themselves stay unpublished until a
//     person has checked the spot-check sample against imagery — see
//     `CAPACITY_RANGE_EMISSION_DEFAULT` and `--capacity-range`.

import fs from "fs";
import path from "path";

import pool from "./db";
import {
  buildNpsFactRow,
  candidatesWithinGate,
  metresToPolygon,
  npsBathroomFacts,
  npsParkingFacts,
  padBounds,
  boundsContain,
  ringsBounds,
  toiletTypeForPoi,
  CAPACITY_RANGE_EMISSION_DEFAULT,
  NPS_JOIN_RADIUS_M,
  NPS_LICENSE,
  NPS_PARKING_DATASET,
  NPS_PARKING_SOURCE_KIND,
  NPS_POIS_DATASET,
  NPS_POIS_SOURCE_KIND,
  NPS_SOURCE_NAME,
  type Bounds,
  type NpsCandidate,
  type NpsFactRow,
  type NpsSource,
  type NpsSourceBook,
  type PolygonRings,
  type Trailhead,
} from "./nps-facts-utils";
import { estimateCapacityRange } from "./parking-capacity";
import type { SourcePoint } from "./trailhead-facts-utils";

export interface Args {
  dataDir: string | null;
  poisPath: string | null;
  parkingPath: string | null;
  trailheadsPath: string | null;
  outPath: string | null;
  radiusM: number;
  limit: number | null;
  show: string[];
  /**
   * Publish the capacity range each lot's area comes to.
   *
   * Off by default and computed either way, so a run always says in its
   * diagnostics what it would have published. See
   * `CAPACITY_RANGE_EMISSION_DEFAULT` for what has to happen before this is
   * turned on.
   */
  capacityRange: boolean;
  help: boolean;
}

export interface NormalizeDependencies {
  readFile?: (filePath: string) => string;
  writeFile?: (filePath: string, contents: string) => void;
  mkdir?: (dir: string) => void;
  loadTrailheads?: () => Promise<Trailhead[]>;
  console?: Pick<Console, "log" | "warn">;
}

export function usage(): string {
  return [
    "Usage:",
    "  tsx src/normalize-nps-trailhead-facts.ts --data-dir=/path/docs/trailheads/data",
    "",
    "Options:",
    "  --data-dir=DIR      directory holding the raw NPS pulls (required)",
    "  --pois=FILE         override <data-dir>/raw/nps-public-pois.jsonl",
    "  --parking=FILE      override <data-dir>/raw/nps-public-parking-lots.jsonl",
    "  --trailheads=FILE   read the trailheads from JSONL instead of the database",
    "  --out=FILE          override <data-dir>/nps-trailhead-facts.jsonl",
    `  --radius-m=N        join radius in metres (default ${NPS_JOIN_RADIUS_M})`,
    "  --limit=N           consider at most N trailheads (smoke runs)",
    "  --show=ID[,ID]      print these destinations' rows in full",
    "  --capacity-range    publish the lot-area capacity range " +
      `(default ${CAPACITY_RANGE_EMISSION_DEFAULT ? "on" : "off"}; the range is`,
    "                      computed and reported either way)",
    "  --help              print this and exit",
  ].join("\n");
}

export function parseArgs(argv: string[]): Args {
  const text = (flag: string): string | null => {
    const raw = argv.find((a) => a.startsWith(`--${flag}=`));
    return raw ? raw.slice(flag.length + 3) : null;
  };
  const radiusRaw = text("radius-m");
  const radiusM = radiusRaw === null ? NPS_JOIN_RADIUS_M : Number(radiusRaw);
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error("--radius-m must be positive");
  const limitRaw = text("limit");
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  const show = (text("show") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return {
    dataDir: text("data-dir"),
    poisPath: text("pois"),
    parkingPath: text("parking"),
    trailheadsPath: text("trailheads"),
    outPath: text("out"),
    radiusM,
    limit,
    show,
    capacityRange: argv.includes("--capacity-range") || CAPACITY_RANGE_EMISSION_DEFAULT,
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function parseJsonl<T>(contents: string): { rows: T[]; malformed: number } {
  const rows: T[] = [];
  let malformed = 0;
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      malformed += 1;
    }
  }
  return { rows, malformed };
}

/**
 * Both services' provenance, read from the download manifest.
 *
 * The manifest's `as_of` becomes `retrieved_at` on every leaf, so a manifest
 * left at last quarter's date stamps last quarter's date on this quarter's
 * facts and nothing downstream can catch it — the date is well-formed, in
 * range, and wrong. The refresh runbook says the same thing about the road
 * sources for the same reason.
 */
export function readNpsSourceBook(
  dataDir: string,
  readFile: (filePath: string) => string
): NpsSourceBook {
  const manifestPath = path.join(dataDir, "raw-datasets-manifest.jsonl");
  const byDataset = new Map<string, { source_url?: string; as_of?: string }>();
  for (const row of parseJsonl<{ dataset?: string; source_url?: string; as_of?: string }>(
    readFile(manifestPath)
  ).rows) {
    if (typeof row.dataset === "string") byDataset.set(row.dataset, row);
  }
  const build = (dataset: string, kind: string): NpsSource => {
    const row = byDataset.get(dataset);
    if (row === undefined) throw new Error(`${manifestPath} has no ${dataset} row`);
    if (typeof row.as_of !== "string" || row.as_of.trim().length === 0) {
      throw new Error(`${dataset} has no as_of date in ${manifestPath}`);
    }
    return {
      kind,
      name: NPS_SOURCE_NAME,
      ...(row.source_url ? { url: row.source_url } : {}),
      license: NPS_LICENSE,
      retrieved_at: row.as_of,
    };
  };
  return {
    pois: build(NPS_POIS_DATASET, NPS_POIS_SOURCE_KIND),
    parking: build(NPS_PARKING_DATASET, NPS_PARKING_SOURCE_KIND),
  };
}

/**
 * Every trailhead in the catalog.
 *
 * Read-only, and the only thing this command asks the production database for —
 * the same query and the same contract as `roads:derive`. `--trailheads=FILE`
 * reads the same rows from a file so a run can be repeated without a database.
 */
export async function loadTrailheadsFromDatabase(): Promise<Trailhead[]> {
  const result = await pool.query<{ id: string; name: string; lat: string; lng: string }>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE features @> ARRAY['trailhead']::destination_feature[]
       AND location IS NOT NULL
     ORDER BY id`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name ?? "",
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

interface PoiFeature {
  point: SourcePoint;
  row: Record<string, unknown>;
}

interface LotFeature {
  /** The polygon's box, already grown by the join radius. */
  bounds: Bounds;
  rings: PolygonRings;
  row: Record<string, unknown>;
}

/** Toilet POIs with a usable point, everything else dropped before the join. */
export function readToiletPois(contents: string): { features: PoiFeature[]; malformed: number; withoutPoint: number } {
  const parsed = parseJsonl<Record<string, unknown>>(contents);
  const features: PoiFeature[] = [];
  let withoutPoint = 0;
  for (const row of parsed.rows) {
    if (toiletTypeForPoi(row.POITYPE) === null) continue;
    const geometry = row._geometry as { x?: unknown; y?: unknown } | undefined;
    const lng = Number(geometry?.x);
    const lat = Number(geometry?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      withoutPoint += 1;
      continue;
    }
    features.push({ point: { lat, lng }, row });
  }
  return { features, malformed: parsed.malformed, withoutPoint };
}

/** Parking polygons with usable rings, boxed for the prefilter. */
export function readParkingLots(
  contents: string,
  radiusM: number
): { features: LotFeature[]; malformed: number; withoutGeometry: number } {
  const parsed = parseJsonl<Record<string, unknown>>(contents);
  const features: LotFeature[] = [];
  let withoutGeometry = 0;
  for (const row of parsed.rows) {
    const geometry = row._geometry as { rings?: unknown } | undefined;
    const rings = geometry?.rings;
    if (!Array.isArray(rings) || rings.length === 0) {
      withoutGeometry += 1;
      continue;
    }
    const bounds = ringsBounds(rings as PolygonRings);
    if (bounds === null) {
      withoutGeometry += 1;
      continue;
    }
    features.push({ bounds: padBounds(bounds, radiusM), rings: rings as PolygonRings, row });
  }
  return { features, malformed: parsed.malformed, withoutGeometry };
}

export interface NormalizeSummary {
  trailheads: number;
  withBathroom: number;
  withParking: number;
  withBoth: number;
  withNeither: number;
  rows: number;
  radiusM: number;
  /**
   * Trailheads with an NPS feature inside the gate that produced no fact.
   *
   * The number that matters most in this summary: it is the difference between
   * "the Park Service has nothing here" and "the Park Service has something
   * here this pipeline declined to publish", and the reasons below say which.
   */
  bathroomAllCandidatesRefused: number;
  parkingAllCandidatesRefused: number;
  /** Candidates within the gate that no block could use, by reason. */
  skipped: Record<string, number>;
  /** Notes not written, by reason — a generic label, a truncated one. */
  notesRefused: Record<string, number>;
  /** Matched lots carrying seasonal text the parking block has no leaf for. */
  parkingSeasonalWithoutLeaf: number;
  /** Whether the computed capacity ranges were published or only reported. */
  capacityRangeEmitted: boolean;
  /**
   * Matched lots by the bucket their area came to, plus the ones that make no
   * claim. Reported whether or not the ranges are published, because "what
   * would this say" is the question a reviewer is asking.
   */
  capacityRanges: Record<string, number>;
  /** Matched lots whose feature carried more than one exterior part. */
  parkingMultiPartLots: number;
  /** Matched lots whose nearest part had at least one hole in it. */
  parkingHoledLots: number;
  /** Matched lots where gross and net areas fall in different buckets. */
  parkingGrossNetBucketFlips: number;
  outPath: string;
}

function count(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

export async function normalizeNpsTrailheadFacts(
  args: Args,
  deps: NormalizeDependencies = {}
): Promise<{ summary: NormalizeSummary; rows: NpsFactRow[] }> {
  const logger = deps.console ?? console;
  const readFile = deps.readFile ?? ((filePath: string) => fs.readFileSync(filePath, "utf8"));
  const writeFile =
    deps.writeFile ??
    ((filePath: string, contents: string) => fs.writeFileSync(filePath, contents, "utf8"));
  const mkdir = deps.mkdir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true }));

  if (!args.dataDir) throw new Error(`${usage()}\n\n--data-dir is required`);
  const dataDir = args.dataDir;
  const poisPath = args.poisPath ?? path.join(dataDir, "raw", "nps-public-pois.jsonl");
  const parkingPath =
    args.parkingPath ?? path.join(dataDir, "raw", "nps-public-parking-lots.jsonl");
  const outPath = args.outPath ?? path.join(dataDir, "nps-trailhead-facts.jsonl");

  const sources = readNpsSourceBook(dataDir, readFile);
  logger.log(
    `NPS trailhead facts (join radius ${args.radiusM} m, retrieved ${sources.pois.retrieved_at})`
  );

  const pois = readToiletPois(readFile(poisPath));
  const lots = readParkingLots(readFile(parkingPath), args.radiusM);
  logger.log(`  toilet POIs: ${pois.features.length} (${pois.withoutPoint} without a point)`);
  logger.log(`  parking lots: ${lots.features.length} (${lots.withoutGeometry} without geometry)`);
  if (pois.malformed > 0 || lots.malformed > 0) {
    logger.warn(`  malformed lines: pois ${pois.malformed}, parking ${lots.malformed}`);
  }

  const loadTrailheads =
    deps.loadTrailheads ??
    (args.trailheadsPath !== null
      ? async () => parseJsonl<Trailhead>(readFile(args.trailheadsPath as string)).rows
      : loadTrailheadsFromDatabase);
  const all = await loadTrailheads();
  const trailheads = args.limit === null ? all : all.slice(0, args.limit);
  logger.log(`  trailheads: ${trailheads.length}`);

  const summary: NormalizeSummary = {
    trailheads: trailheads.length,
    withBathroom: 0,
    withParking: 0,
    withBoth: 0,
    withNeither: 0,
    rows: 0,
    radiusM: args.radiusM,
    bathroomAllCandidatesRefused: 0,
    parkingAllCandidatesRefused: 0,
    skipped: {},
    notesRefused: {},
    parkingSeasonalWithoutLeaf: 0,
    capacityRangeEmitted: args.capacityRange,
    capacityRanges: {},
    parkingMultiPartLots: 0,
    parkingHoledLots: 0,
    parkingGrossNetBucketFlips: 0,
    outPath,
  };
  const rows: NpsFactRow[] = [];

  for (const trailhead of trailheads) {
    if (!Number.isFinite(trailhead.lat) || !Number.isFinite(trailhead.lng)) {
      summary.withNeither += 1;
      continue;
    }
    const poiCandidates = candidatesWithinGate(trailhead, pois.features, args.radiusM);
    const lotCandidates: NpsCandidate[] = [];
    for (const lot of lots.features) {
      if (!boundsContain(lot.bounds, trailhead)) continue;
      const distanceM = metresToPolygon(trailhead, lot.rings);
      if (distanceM === null || distanceM > args.radiusM) continue;
      // The rings ride along: the capacity range is read off this lot's own
      // ground area, and re-parsing the geometry out of the row would be a
      // second reader of the same thing.
      lotCandidates.push({ distanceM, row: lot.row, rings: lot.rings });
    }
    lotCandidates.sort((a, b) => a.distanceM - b.distanceM);

    const bathroom = npsBathroomFacts(poiCandidates, sources.pois);
    const parking = npsParkingFacts(lotCandidates, sources.parking, trailhead, {
      emitCapacityRange: args.capacityRange,
    });
    const row = buildNpsFactRow(trailhead, bathroom.outcome, parking.outcome);

    // Counted before the row is, so a trailhead whose only nearby lot is the
    // maintenance yard still says so in the summary even though it writes no
    // row at all.
    for (const skip of bathroom.skipped) count(summary.skipped, skip.reason);
    for (const skip of parking.skipped) count(summary.skipped, skip.reason);
    if (bathroom.outcome === null && bathroom.candidates > 0) {
      summary.bathroomAllCandidatesRefused += 1;
    }
    if (parking.outcome === null && parking.candidates > 0) {
      summary.parkingAllCandidatesRefused += 1;
    }

    if (bathroom.outcome !== null) summary.withBathroom += 1;
    if (parking.outcome !== null) summary.withParking += 1;
    if (bathroom.outcome !== null && parking.outcome !== null) summary.withBoth += 1;
    if (row === null) {
      summary.withNeither += 1;
      continue;
    }
    const refused = parking.outcome?.diagnostics.location_note_refused ?? null;
    if (refused !== null) count(summary.notesRefused, refused);
    if (parking.outcome?.diagnostics.seasonal_description) summary.parkingSeasonalWithoutLeaf += 1;
    const area = parking.outcome?.diagnostics.area ?? null;
    if (area !== null) {
      count(summary.capacityRanges, area.capacity_range ?? `none (${area.capacity_range_withheld})`);
      if (area.parts > 1) summary.parkingMultiPartLots += 1;
      if (area.holes > 0) summary.parkingHoledLots += 1;
      // The area contract's second half, measured on the lots it applies to:
      // reading the gross outline where the net area belongs moves this many
      // answers, and each one moves upward.
      if (estimateCapacityRange(area.gross_area_m2) !== area.capacity_range) {
        summary.parkingGrossNetBucketFlips += 1;
      }
    } else if (parking.outcome !== null) {
      count(summary.capacityRanges, "none (no_usable_ring)");
    }
    rows.push(row);
  }
  summary.rows = rows.length;

  mkdir(path.dirname(outPath));
  writeFile(outPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

  logSummary(summary, rows, args.show, logger);
  return { summary, rows };
}

function logSummary(
  summary: NormalizeSummary,
  rows: readonly NpsFactRow[],
  show: readonly string[],
  logger: Pick<Console, "log" | "warn">
): void {
  logger.log("");
  logger.log(`Trailheads considered:    ${summary.trailheads}`);
  logger.log(`  bathroom facts:         ${summary.withBathroom}`);
  logger.log(`  parking facts:          ${summary.withParking}`);
  logger.log(`  both:                   ${summary.withBoth}`);
  logger.log(`  neither (no row):       ${summary.withNeither}`);
  if (summary.bathroomAllCandidatesRefused > 0) {
    logger.log(`  toilet POI near, none usable: ${summary.bathroomAllCandidatesRefused}`);
  }
  if (summary.parkingAllCandidatesRefused > 0) {
    logger.log(`  lot near, none usable:  ${summary.parkingAllCandidatesRefused}`);
  }
  const skips = Object.entries(summary.skipped).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of skips) logger.log(`    - candidate skipped, ${reason}: ${count}`);
  const notes = Object.entries(summary.notesRefused).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of notes) logger.log(`    - no location note, ${reason}: ${count}`);
  if (summary.parkingSeasonalWithoutLeaf > 0) {
    logger.log(
      `    - lot seasonal text carried, not published (no parking season leaf): ` +
        `${summary.parkingSeasonalWithoutLeaf}`
    );
  }
  logger.log(
    `Lot capacity ranges       ${
      summary.capacityRangeEmitted ? "(published)" : "(computed, NOT published)"
    }`
  );
  const ranges = Object.entries(summary.capacityRanges).sort((a, b) => b[1] - a[1]);
  for (const [range, count] of ranges) logger.log(`    ${range}: ${count}`);
  logger.log(`    multi-part lots:      ${summary.parkingMultiPartLots}`);
  logger.log(`    lots with a hole:     ${summary.parkingHoledLots}`);
  logger.log(`    gross would move it:  ${summary.parkingGrossNetBucketFlips}`);
  logger.log(`Rows written:             ${summary.rows}`);
  logger.log(`  ${summary.outPath}`);

  for (const id of show) {
    const row = rows.find((candidate) => candidate.destination_id === id);
    logger.log("");
    if (row === undefined) {
      logger.warn(`  ${id}: no row — NPS has no feature within ${summary.radiusM} m`);
      continue;
    }
    logger.log(`  ${row.destination_id}  ${row.destination_name}`);
    logger.log(JSON.stringify(row, null, 2));
  }
}

function isDirectRun(scriptPath: string | undefined): boolean {
  return /(?:^|[/\\])normalize-nps-trailhead-facts\.(?:ts|js)$/.test(scriptPath ?? "");
}

if (isDirectRun(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  normalizeNpsTrailheadFacts(args)
    .then(async () => {
      if (args.trailheadsPath === null) await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      if (args.trailheadsPath === null) await pool.end();
      process.exit(1);
    });
}
