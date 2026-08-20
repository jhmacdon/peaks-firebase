// Derive the access-road facts for every trailhead in the catalog.
//
//   npm run roads:derive -- --data-dir=/path/to/peaks/docs/trailheads/data
//
// This is the second half of phase 2: the road network is already loaded and
// noded (roads:import), and this walks it once per trailhead and writes one
// JSONL row per trailhead — vehicle, surface, gate window, and the segment
// that set each, with a source block per leaf. Nothing is written to the
// `peaks` database here. The rows are the input to the import that will be,
// and they are shaped like `TrailheadRoadAccess` in lib/amenities.ts so that
// import is a copy rather than a translation.
//
// The database is read once, for the trailheads themselves: id, name and
// coordinates. Road segments never go near it.
//
// Every rule this obeys is in migrate/docs/roads-processing-store.md and in
// roads/approach.ts. The two worth repeating at the top of the file:
//
//   - A path holding one unranked edge has no vehicle answer. It is reported
//     as `unranked_path`, not as the second-worst known edge.
//   - A window nobody recorded is not an open gate. Seasonal windows come from
//     MVUM segments flagged seasonal, and they are intersected across the whole
//     path rather than picked from.

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import pool from "../db";
import {
  loadGraph,
  snapTrailhead,
  DEFAULT_SNAP_RADIUS_M,
  type SnapCandidate,
  type TraversalEdge,
} from "./graph";
import type { SeasonWindow } from "./mvum-seasons";
import { openRoadStore, sqlLiteral, type RoadStore } from "./store";
import { defaultStorePath } from "./import-road-network";
import {
  deriveApproach,
  findApproachPath,
  humanSegmentRef,
  intersectSeasonWindows,
  longestWindow,
  seasonWindowToIsoDates,
  DEFAULT_MAX_PATH_MILES,
  DEFAULT_MAX_STRAIGHT_LINE_M,
  type PathPreference,
  type SkipReason,
  type WalkGraph,
} from "./approach";

/** A trailhead as the catalog holds it. */
export interface Trailhead {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Where a fact came from, in the shape `lib/amenities.ts` stores. */
export interface LeafSource {
  kind: string;
  name: string;
  url?: string;
}

export interface SourcedLeaf<T> {
  value: T;
  source: LeafSource;
  retrieved_at: string;
}

/** One derived trailhead, as a row of the output file. */
export interface ApproachRow {
  destination_id: string;
  destination_name: string;
  snapped: boolean;
  snap_distance_m: number | null;
  anchor_reached: boolean;
  path_miles: number | null;
  surface?: SourcedLeaf<string>;
  high_clearance?: SourcedLeaf<string>;
  four_wheel_drive?: SourcedLeaf<boolean>;
  seasonal_window?: SourcedLeaf<{ opens: string; closes: string }>;
  limiting_segment_ref?: SourcedLeaf<string>;
  skip_reason?: SkipReason;
  /** Everything needed to audit the answer a year from now. */
  derivation?: ApproachAudit;
}

export interface ApproachAudit {
  snap_segment_key: string;
  /** Positional and rebuilt on every refresh — for debugging only, never a reference. */
  snap_edge_id: string;
  anchor_segment_key: string;
  anchor_name: string | null;
  anchor_maint_level: string | null;
  path_edges: number;
  /** Every edge on the path in full, anchor included. `path_miles` is the drive. */
  path_edge_miles: number | null;
  path_segment_keys: string[];
  /** The agency's own id for the worst segment. This is the durable reference. */
  limiting_segment_key: string | null;
  limiting_vehicle_requirement: string | null;
  surface_segment_key: string | null;
  surface_class: string | null;
  unranked_edges: number;
  unsurfaced_edges: number;
  unmeasured_edges: number;
  /** How many path segments carry an MVUM gate window, of how many looked at. */
  season_segments_with_window: number;
  season_segments: number;
  /** More than one surviving window means the printed one is the longest of them. */
  season_windows_found: number;
  /** A BLM segment on the path is season-restricted but carries no dates. */
  season_restricted_without_dates: boolean;
}

export interface Args {
  dataDir: string | null;
  storePath: string | null;
  outPath: string | null;
  trailheadsPath: string | null;
  snapRadiusMetres: number;
  maxStraightLineMetres: number;
  maxPathMiles: number;
  prefer: PathPreference;
  seasonYear: number;
  sample: number;
  sampleSeed: number;
  limit: number | null;
}

export function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | null => {
    const found = argv.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.slice(flag.length + 3) : null;
  };
  const number = (flag: string, fallback: number): number => {
    const raw = value(flag);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`--${flag} must be a number`);
    return parsed;
  };
  const prefer = value("prefer") ?? "nearest";
  if (prefer !== "nearest" && prefer !== "easiest") {
    throw new Error("--prefer must be nearest or easiest");
  }
  return {
    dataDir: value("data-dir"),
    storePath: value("store"),
    outPath: value("out"),
    trailheadsPath: value("trailheads"),
    snapRadiusMetres: number("snap-radius", DEFAULT_SNAP_RADIUS_M),
    maxStraightLineMetres: number("max-straight-line-km", DEFAULT_MAX_STRAIGHT_LINE_M / 1000) * 1000,
    maxPathMiles: number("max-path-miles", DEFAULT_MAX_PATH_MILES),
    prefer,
    seasonYear: number("season-year", new Date().getUTCFullYear()),
    sample: number("sample", 0),
    sampleSeed: number("sample-seed", 1),
    limit: value("limit") === null ? null : number("limit", 0),
  };
}

/** Default output: beside the other importer artifacts in the data directory. */
export function defaultOutPath(dataDir: string): string {
  return path.join(dataDir, "trailhead-road-access.jsonl");
}

/**
 * The three road sources, named for a person reading a detail sheet.
 *
 * The URLs and dates come from the download manifest rather than this file, so
 * a refresh moves the `retrieved_at` on every leaf it produces.
 */
const SOURCE_NAMES: Record<string, { manifest: string; name: string }> = {
  usfs_roadcore: {
    manifest: "usfs_roadcore",
    name: "USFS National Forest System Roads (RoadCore)",
  },
  usfs_mvum: {
    manifest: "usfs_mvum_roads",
    name: "USFS Motor Vehicle Use Map roads",
  },
  blm_gtlf: {
    manifest: "blm_gtlf_public_display",
    name: "BLM Ground Transportation Linear Features",
  },
};

export type SourceBook = Record<string, LeafSource & { retrieved_at: string }>;

/** Read the download manifest for each source's URL and snapshot date. */
export async function readSourceBook(dataDir: string): Promise<SourceBook> {
  const manifestPath = path.join(dataDir, "raw-datasets-manifest.jsonl");
  const text = await readFile(manifestPath, "utf8");
  const byDataset = new Map<string, { source_url?: string; as_of?: string }>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const row = JSON.parse(trimmed) as { dataset?: string; source_url?: string; as_of?: string };
    if (typeof row.dataset === "string") byDataset.set(row.dataset, row);
  }
  const book: SourceBook = {};
  for (const [kind, entry] of Object.entries(SOURCE_NAMES)) {
    const row = byDataset.get(entry.manifest);
    if (row === undefined) throw new Error(`${manifestPath} has no ${entry.manifest} row`);
    if (typeof row.as_of !== "string") throw new Error(`${entry.manifest} has no as_of date`);
    book[kind] = {
      kind,
      name: entry.name,
      ...(row.source_url ? { url: row.source_url } : {}),
      retrieved_at: row.as_of,
    };
  }
  return book;
}

function leaf<T>(value: T, source: SourceBook[string]): SourcedLeaf<T> {
  const { retrieved_at, ...rest } = source;
  return { value, source: rest, retrieved_at };
}

/**
 * Every trailhead in the catalog.
 *
 * Read-only, and the only thing this command asks the production database for.
 * `--trailheads=` reads the same rows from a file instead, so a run can be
 * repeated without the database.
 */
export async function loadTrailheads(args: Args): Promise<Trailhead[]> {
  if (args.trailheadsPath !== null) {
    const text = await readFile(args.trailheadsPath, "utf8");
    const rows: Trailhead[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      rows.push(JSON.parse(trimmed) as Trailhead);
    }
    return rows;
  }
  const result = await pool.query<{ id: string; name: string; lat: string; lng: string }>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE features @> ARRAY['trailhead']::destination_feature[]
       AND location IS NOT NULL
     ORDER BY id`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

/** Windows for one MVUM segment, by the class that answers for a car. */
interface MvumWindows {
  passenger: SeasonWindow[];
  highClearance: SeasonWindow[];
}

/**
 * The gate windows for the RoadCore segments on the derived paths.
 *
 * Two classes are read. They agree on 31,641 of the 31,713 segments that carry
 * both, so `passenger_vehicle` is the answer wherever it exists; the
 * `high_clearance_vehicle` window covers the 1,270 segments where a passenger
 * vehicle has no listed window at all, which are exactly the rough approaches
 * this pipeline exists to describe.
 *
 * Windows are then intersected across every MVUM segment the link returns, per
 * the contract: a RoadCore segment can span a stretch MVUM splits at a gate,
 * and picking one of its halves would publish the road as open on a day the
 * other half calls shut.
 */
async function loadSeasonWindows(
  store: RoadStore,
  segmentKeys: readonly string[],
): Promise<Map<string, { windows: SeasonWindow[][]; links: number }>> {
  const result = new Map<string, { windows: SeasonWindow[][]; links: number }>();
  const roadcoreKeys = segmentKeys.filter((key) => key.startsWith("usfs_roadcore:"));
  const chunkSize = 800;
  const perSegment = new Map<string, Map<string, MvumWindows>>();
  for (let start = 0; start < roadcoreKeys.length; start += chunkSize) {
    const chunk = roadcoreKeys.slice(start, start + chunkSize);
    const rows = await store.all<{
      roadcore_key: string;
      mvum_key: string;
      vehicle_class: string;
      opens: string;
      closes: string;
      wraps_year: boolean;
    }>(`SELECT l.roadcore_key, w.mvum_key, w.vehicle_class, w.opens, w.closes, w.wraps_year
        FROM roadcore_mvum_link l
        JOIN mvum_season_window w ON w.mvum_key = l.mvum_key
        WHERE l.roadcore_key IN (${chunk.map((key) => sqlLiteral(key)).join(", ")})
          AND w.vehicle_class IN ('passenger_vehicle', 'high_clearance_vehicle')`);
    for (const row of rows) {
      let segment = perSegment.get(row.roadcore_key);
      if (segment === undefined) {
        segment = new Map<string, MvumWindows>();
        perSegment.set(row.roadcore_key, segment);
      }
      let windows = segment.get(row.mvum_key);
      if (windows === undefined) {
        windows = { passenger: [], highClearance: [] };
        segment.set(row.mvum_key, windows);
      }
      const window: SeasonWindow = {
        opens: row.opens,
        closes: row.closes,
        wrapsYear: row.wraps_year === true,
      };
      if (row.vehicle_class === "passenger_vehicle") windows.passenger.push(window);
      else windows.highClearance.push(window);
    }
  }
  for (const [segmentKey, mvumSegments] of perSegment) {
    const sets: SeasonWindow[][] = [];
    for (const windows of mvumSegments.values()) {
      const chosen = windows.passenger.length > 0 ? windows.passenger : windows.highClearance;
      if (chosen.length > 0) sets.push(chosen);
    }
    result.set(segmentKey, { windows: sets, links: mvumSegments.size });
  }
  return result;
}

/** Which BLM segments on the paths carry a season restriction with no dates. */
async function loadBlmSeasonFlags(
  store: RoadStore,
  segmentKeys: readonly string[],
): Promise<Set<string>> {
  const blmKeys = segmentKeys.filter((key) => key.startsWith("blm_gtlf:"));
  const flagged = new Set<string>();
  const chunkSize = 800;
  for (let start = 0; start < blmKeys.length; start += chunkSize) {
    const chunk = blmKeys.slice(start, start + chunkSize);
    const rows = await store.all<{ segment_key: string }>(
      `SELECT segment_key FROM road_segment
       WHERE season_restricted AND segment_key IN (${chunk.map((k) => sqlLiteral(k)).join(", ")})`,
    );
    for (const row of rows) flagged.add(row.segment_key);
  }
  return flagged;
}

/** One trailhead's walk, before the seasonal windows are attached. */
interface WalkOutcome {
  trailhead: Trailhead;
  snap: SnapCandidate | null;
  path: TraversalEdge[] | null;
  anchor: TraversalEdge | null;
  /** The drive from the trailhead to the anchor, null when an edge has no length. */
  driveMiles: number | null;
}

function narrative(outcome: WalkOutcome, row: ApproachRow): string {
  if (outcome.path === null || outcome.anchor === null) {
    return `${outcome.trailhead.name}: ${row.skip_reason}`;
  }
  const miles = row.path_miles === null ? "unknown" : `${row.path_miles.toFixed(1)} mi`;
  const anchorName = outcome.anchor.name ?? humanSegmentRef({
    source: outcome.anchor.source,
    routeId: outcome.anchor.routeId,
    name: outcome.anchor.name,
    segmentKey: outcome.anchor.segmentKey,
  });
  const vehicle = row.derivation?.limiting_vehicle_requirement ?? "unknown";
  const worst = row.limiting_segment_ref?.value ?? "unknown";
  const surface = row.surface?.value ?? "unknown";
  const season = row.seasonal_window
    ? `, gate ${row.seasonal_window.value.opens} to ${row.seasonal_window.value.closes}`
    : "";
  return (
    `${outcome.trailhead.name}: ${outcome.path.length} edges / ${miles} to ` +
    `${anchorName} (${outcome.anchor.maintLevel ?? "?"}); worst ${vehicle} on ${worst}, ` +
    `roughest ${surface}${season}`
  );
}

/** A repeatable shuffle, so the audit sample is the same on a re-run. */
function sampleIndexes(count: number, take: number, seed: number): number[] {
  const indexes = Array.from({ length: count }, (_, index) => index);
  let state = seed >>> 0 || 1;
  for (let i = count - 1; i > 0; i -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const j = state % (i + 1);
    const swap = indexes[i]!;
    indexes[i] = indexes[j]!;
    indexes[j] = swap;
  }
  return indexes.slice(0, take).sort((a, b) => a - b);
}

export async function deriveTrailheadApproaches(args: Args): Promise<void> {
  if (!args.dataDir) {
    throw new Error("--data-dir is required (the peaks docs/trailheads/data directory)");
  }
  const dataDir = path.resolve(args.dataDir);
  const storePath = path.resolve(args.storePath ?? defaultStorePath(dataDir));
  if (!existsSync(storePath)) {
    throw new Error(`no processing store at ${storePath} — run roads:import first`);
  }
  const outPath = path.resolve(args.outPath ?? defaultOutPath(dataDir));
  const sources = await readSourceBook(dataDir);

  const started = Date.now();
  const trailheads = await loadTrailheads(args);
  const scoped = args.limit === null ? trailheads : trailheads.slice(0, args.limit);
  console.log(`trailheads: ${scoped.length.toLocaleString()}`);

  const store = await openRoadStore(storePath, { readOnly: true, memoryLimit: "4GB" });
  try {
    const graph = await loadGraph(store);
    const walkGraph: WalkGraph = {
      adjacency: graph.adjacency,
      byId: graph.byId,
      nodes: graph.nodes,
    };
    console.log(
      `graph: ${graph.edges.length.toLocaleString()} edges, ` +
        `${graph.nodes.size.toLocaleString()} nodes`,
    );

    const outcomes: WalkOutcome[] = [];
    for (const trailhead of scoped) {
      const candidates = await snapTrailhead(store, {
        lon: trailhead.lng,
        lat: trailhead.lat,
        radiusMetres: args.snapRadiusMetres,
        limit: 1,
      });
      const snap = candidates[0] ?? null;
      if (snap === null) {
        outcomes.push({ trailhead, snap: null, path: null, anchor: null, driveMiles: null });
        continue;
      }
      const walk = findApproachPath(
        walkGraph,
        snap,
        { lon: trailhead.lng, lat: trailhead.lat },
        {
          maxStraightLineMetres: args.maxStraightLineMetres,
          maxPathMiles: args.maxPathMiles,
          prefer: args.prefer,
        },
      );
      outcomes.push({
        trailhead,
        snap,
        path: walk?.edges ?? null,
        anchor: walk?.anchor ?? null,
        driveMiles: walk?.driveMiles ?? null,
      });
    }

    const pathKeys = new Set<string>();
    for (const outcome of outcomes) {
      for (const edge of outcome.path ?? []) pathKeys.add(edge.segmentKey);
    }
    const seasons = await loadSeasonWindows(store, [...pathKeys]);
    const blmSeasonFlags = await loadBlmSeasonFlags(store, [...pathKeys]);

    const sourceFor = (kind: string | undefined): SourceBook[string] => {
      const found = kind === undefined ? undefined : sources[kind];
      if (found === undefined) throw new Error(`no source metadata for ${kind}`);
      return found;
    };

    const rows: ApproachRow[] = [];
    const skips: Record<string, number> = {};
    let withVehicle = 0;
    let withSurface = 0;
    let withWindow = 0;
    let multiWindow = 0;

    for (const outcome of outcomes) {
      const { trailhead, snap, path, anchor } = outcome;
      const row: ApproachRow = {
        destination_id: trailhead.id,
        destination_name: trailhead.name,
        snapped: snap !== null,
        snap_distance_m: snap === null ? null : Number(snap.distanceMetres.toFixed(1)),
        anchor_reached: path !== null,
        path_miles: null,
      };
      if (snap === null) {
        row.skip_reason = "no_snap";
        skips.no_snap = (skips.no_snap ?? 0) + 1;
        rows.push(row);
        continue;
      }
      if (path === null || anchor === null) {
        row.skip_reason = "no_anchor";
        skips.no_anchor = (skips.no_anchor ?? 0) + 1;
        rows.push(row);
        continue;
      }

      const derived = deriveApproach(path);
      row.path_miles =
        outcome.driveMiles === null ? null : Number(outcome.driveMiles.toFixed(2));

      // Windows are intersected across the whole path. A segment with no window
      // is not a constraint — and is not an open gate either, which is why the
      // count of segments that had one is recorded beside the answer.
      const windowSets: SeasonWindow[][] = [];
      let segmentsWithWindow = 0;
      let seasonSegments = 0;
      let restrictedWithoutDates = false;
      for (const segmentKey of derived.summary.segmentKeys) {
        if (segmentKey.startsWith("usfs_roadcore:")) {
          seasonSegments += 1;
          const found = seasons.get(segmentKey);
          if (found !== undefined && found.windows.length > 0) {
            segmentsWithWindow += 1;
            for (const set of found.windows) windowSets.push(set);
          }
        } else if (blmSeasonFlags.has(segmentKey)) {
          restrictedWithoutDates = true;
        }
      }
      const intersected = intersectSeasonWindows(windowSets);
      const window = longestWindow(intersected);
      const isoWindow = window === null ? null : seasonWindowToIsoDates(window, args.seasonYear);

      if (derived.vehicle !== null && derived.vehicle.carPassable) {
        const source = sourceFor(derived.limiting?.source);
        if (derived.vehicle.highClearance !== null) {
          row.high_clearance = leaf(derived.vehicle.highClearance, source);
        }
        if (derived.vehicle.fourWheelDrive !== null) {
          row.four_wheel_drive = leaf(derived.vehicle.fourWheelDrive, source);
        }
        withVehicle += 1;
      }
      if (derived.surface !== null) {
        row.surface = leaf(
          derived.surface,
          sourceFor(
            path.find((edge) => edge.segmentKey === derived.summary.surface?.limitingSegmentKey)
              ?.source,
          ),
        );
        withSurface += 1;
      }
      if (isoWindow !== null) {
        row.seasonal_window = leaf(isoWindow, sourceFor("usfs_mvum"));
        withWindow += 1;
        if (intersected.length > 1) multiWindow += 1;
      }
      if (derived.limiting !== null) {
        row.limiting_segment_ref = leaf(
          humanSegmentRef(derived.limiting),
          sourceFor(derived.limiting.source),
        );
      }
      if (derived.skipReason !== null) {
        row.skip_reason = derived.skipReason;
        skips[derived.skipReason] = (skips[derived.skipReason] ?? 0) + 1;
      }

      row.derivation = {
        snap_segment_key: snap.segmentKey,
        snap_edge_id: snap.edgeId,
        anchor_segment_key: anchor.segmentKey,
        anchor_name: anchor.name,
        anchor_maint_level: anchor.maintLevel,
        path_edges: path.length,
        path_edge_miles:
          derived.summary.lengthMiles === null
            ? null
            : Number(derived.summary.lengthMiles.toFixed(2)),
        path_segment_keys: derived.summary.segmentKeys,
        limiting_segment_key: derived.summary.vehicle?.limitingSegmentKey ?? null,
        limiting_vehicle_requirement: derived.summary.vehicle?.value ?? null,
        surface_segment_key: derived.summary.surface?.limitingSegmentKey ?? null,
        surface_class: derived.summary.surface?.value ?? null,
        unranked_edges: derived.summary.unrankedEdges,
        unsurfaced_edges: derived.summary.unsurfacedEdges,
        unmeasured_edges: derived.summary.unmeasuredEdges,
        season_segments_with_window: segmentsWithWindow,
        season_segments: seasonSegments,
        season_windows_found: intersected.length,
        season_restricted_without_dates: restrictedWithoutDates,
      };
      rows.push(row);
    }

    mkdirSync(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

    const snapped = rows.filter((row) => row.snapped).length;
    const reached = rows.filter((row) => row.anchor_reached).length;
    const share = (part: number, whole: number): string =>
      whole === 0 ? "0%" : `${Math.round((100 * part) / whole)}%`;
    console.log(`  snapped within ${args.snapRadiusMetres} m: ${snapped} (${share(snapped, rows.length)})`);
    console.log(`  reached an anchor: ${reached} (${share(reached, snapped)} of snapped)`);
    console.log(`  vehicle answer: ${withVehicle} (${share(withVehicle, rows.length)} of the catalog)`);
    console.log(`  surface answer: ${withSurface}`);
    console.log(`  gate window: ${withWindow}` + (multiWindow > 0 ? ` (${multiWindow} kept the longest of several)` : ""));
    console.log("  skipped:");
    for (const [reason, count] of Object.entries(skips).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason}: ${count}`);
    }
    console.log(`  wrote ${rows.length.toLocaleString()} rows to ${outPath}`);

    if (args.sample > 0) {
      const derivedRows = rows
        .map((row, index) => ({ row, outcome: outcomes[index]! }))
        .filter((pair) => pair.row.anchor_reached);
      console.log(`\nsample of ${Math.min(args.sample, derivedRows.length)} derived approaches:`);
      for (const index of sampleIndexes(derivedRows.length, args.sample, args.sampleSeed)) {
        const pair = derivedRows[index]!;
        console.log(`  ${narrative(pair.outcome, pair.row)}`);
      }
    }
    console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    store.close();
    if (args.trailheadsPath === null) await pool.end();
  }
}

function isDirectRun(scriptPath: string | undefined): boolean {
  return /(?:^|[/\\])derive-trailhead-approaches\.(?:ts|js)$/.test(scriptPath ?? "");
}

if (isDirectRun(process.argv[1])) {
  deriveTrailheadApproaches(parseArgs(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
