// Load the federal access-road datasets into the local processing store,
// normalize them, and build the graph the approach-path walk needs.
//
//   npm run roads:import -- --data-dir=/path/to/peaks/docs/trailheads/data
//
// Sources, all already downloaded (see raw-datasets-manifest.jsonl):
//   - Trans_RoadCore_FS.gdb.zip   USFS RoadCore, 368,055 segments
//   - Trans_MVUM_Road.gdb.zip     USFS MVUM, 150,722 segments
//   - blm-gtlf-public-display.jsonl  BLM GTLF, 111,149 segments
//
// Reading is done by DuckDB's spatial extension, which carries GDAL: the
// geodatabases are read straight out of their zip files through /vsizip, so
// nothing is unpacked and the run is repeatable. Every table this script owns
// is dropped and rebuilt, so a re-run is a full refresh.
//
// The value mappings live in the pure modules beside this file. Rather than
// walk 630,000 rows in JavaScript, each distinct raw value is mapped once in
// TypeScript, written to a small lookup table, and joined in SQL — so the unit
// tested functions stay the only authority on what a value means.

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  applyRouteUseClass,
  classifyBlmDrivability,
  defaultRouteUseClassMapPath,
  normalizeBlmSeasonRestriction,
  normalizeBlmSurface,
  parseRouteUseClassMap,
  type NotDrivableReason,
  type RouteUseClassMap,
} from "./blm-classes";
import {
  MVUM_VEHICLE_CLASSES,
  normalizeSeasonalFlag,
  seasonWindowsForClass,
} from "./mvum-seasons";
import {
  isPublicMotorized,
  MAINT_LEVEL_NUMBER,
  parseMaintenanceLevel,
  parseSurfaceType,
  SURFACE_RANK,
  VEHICLE_RANK,
  vehicleRequirementFromBlmClass,
  vehicleRequirementFromMaintenanceLevel,
} from "./road-enums";
import { clusterEndpoints, metresBetweenSql, type Endpoint } from "./topology";
import { openRoadStore, sqlLiteral, toCount, type RoadStore } from "./store";

/** Row counts the sources are expected to carry, from the download manifest. */
export const EXPECTED_ROW_COUNTS = {
  roadcore_total: 368055,
  roadcore_open: 174051,
  mvum: 150722,
  blm: 111149,
} as const;

/** Endpoints this far apart or nearer become one graph node. */
export const DEFAULT_SNAP_TOLERANCE_M = 10;

/**
 * DuckDB memory ceiling. Capped rather than left at the default, which is most
 * of the machine: the vertex pass is large and the run should not squeeze
 * everything else on a laptop. Raise it with `--memory-limit` on a big box.
 */
export const DEFAULT_MEMORY_LIMIT = "6GB";

export const STAGES = [
  "roadcore",
  "mvum",
  "blm",
  "normalize",
  "seasons",
  "link",
  "topology",
] as const;

export type Stage = (typeof STAGES)[number];

export interface Args {
  dataDir: string | null;
  storePath: string | null;
  /** The reviewed BLM class map. Defaults to the repo copy; --map overrides. */
  routeUseClassMapPath: string | null;
  snapToleranceMetres: number;
  memoryLimit: string | null;
  stages: Stage[];
}

export function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | null => {
    const found = argv.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.slice(flag.length + 3) : null;
  };
  const only = value("only");
  const tolerance = value("snap-tolerance");
  const stages = only
    ? only.split(",").map((s) => s.trim() as Stage)
    : [...STAGES];
  for (const stage of stages) {
    if (!STAGES.includes(stage)) {
      throw new Error(`unknown stage ${stage}; expected one of ${STAGES.join(", ")}`);
    }
  }
  return {
    dataDir: value("data-dir"),
    storePath: value("store"),
    routeUseClassMapPath: value("map"),
    snapToleranceMetres: tolerance ? Number(tolerance) : DEFAULT_SNAP_TOLERANCE_M,
    memoryLimit: value("memory-limit"),
    stages,
  };
}

/**
 * Where each source sits.
 *
 * The downloads live under the data directory, in the `peaks` checkout. The
 * reviewed class map does not: it is a judgement rather than data, so its
 * canonical copy is version-controlled here and `mapPath` — `--map` — is what
 * points somewhere else.
 */
export function sourcePaths(dataDir: string, mapPath?: string | null) {
  const raw = path.join(dataDir, "raw");
  return {
    roadcore: `/vsizip/${path.join(raw, "Trans_RoadCore_FS.gdb.zip")}/Trans_RoadCore_FS.gdb`,
    roadcoreZip: path.join(raw, "Trans_RoadCore_FS.gdb.zip"),
    mvum: `/vsizip/${path.join(raw, "Trans_MVUM_Road.gdb.zip")}/Trans_MVUM_Road.gdb`,
    mvumZip: path.join(raw, "Trans_MVUM_Road.gdb.zip"),
    blm: path.join(raw, "blm-gtlf-public-display.jsonl"),
    routeUseClassMap: mapPath ?? defaultRouteUseClassMapPath(),
  };
}

/** Default store location: beside the raw data, never inside the repo. */
export function defaultStorePath(dataDir: string): string {
  return path.join(dataDir, "processing", "roads.duckdb");
}

// A geodatabase row whose SHAPE is an ArcGIS true curve cannot be read as WKB
// by the spatial extension. There are 18 such rows in RoadCore and 11 in MVUM,
// so they are recorded by kind and left without geometry rather than dropped.
const GEOM_KIND_SQL = `CASE
    WHEN SHAPE IS NULL THEN 'missing'
    WHEN hex(SHAPE[2:5]) = '05000000' THEN 'multilinestring'
    ELSE 'unsupported_curve'
  END`;
const GEOM_SQL = `CASE
    WHEN SHAPE IS NOT NULL AND hex(SHAPE[2:5]) = '05000000' THEN ST_GeomFromWKB(SHAPE)
  END`;

async function loadGeodatabase(
  store: RoadStore,
  table: string,
  gdalPath: string,
): Promise<number> {
  await store.run(`DROP TABLE IF EXISTS ${table}`);
  await store.run(`CREATE TABLE ${table} AS
    SELECT * EXCLUDE (SHAPE),
      ${GEOM_KIND_SQL} AS geom_kind,
      ${GEOM_SQL} AS geom
    FROM st_read(${sqlLiteral(gdalPath)}, keep_wkb = true)`);
  const row = await store.one<{ n: unknown }>(`SELECT count(*) AS n FROM ${table}`);
  return toCount(row.n);
}

/**
 * Read the BLM JSONL, turning each ArcGIS `paths` array into a MULTILINESTRING.
 *
 * The rows are flat attribute objects with the geometry under `_geometry`, so
 * the conversion is a text build inside DuckDB — no row-by-row work in Node.
 */
async function loadBlm(store: RoadStore, jsonlPath: string): Promise<number> {
  await store.run("DROP TABLE IF EXISTS raw_blm");
  await store.run(`CREATE TABLE raw_blm AS
    SELECT * EXCLUDE (_geometry),
      ST_GeomFromText('MULTILINESTRING (' ||
        list_aggregate(list_transform(_geometry.paths, path ->
          '(' || list_aggregate(list_transform(path,
            pt -> pt[1]::VARCHAR || ' ' || pt[2]::VARCHAR), 'string_agg', ', ') || ')'
        ), 'string_agg', ', ') || ')') AS geom,
      CASE WHEN _geometry.paths IS NULL THEN 'missing' ELSE 'multilinestring' END AS geom_kind
    FROM read_json(${sqlLiteral(jsonlPath)}, format = 'newline_delimited',
                   maximum_object_size = 20000000)`);
  const row = await store.one<{ n: unknown }>("SELECT count(*) AS n FROM raw_blm");
  return toCount(row.n);
}

/** Insert a small lookup table from rows already computed in TypeScript. */
async function createLookup(
  store: RoadStore,
  table: string,
  columns: string[],
  rows: (string | number | boolean | null)[][],
): Promise<void> {
  await store.run(`DROP TABLE IF EXISTS ${table}`);
  const columnDefs = columns.join(", ");
  if (rows.length === 0) {
    await store.run(`CREATE TABLE ${table} (${columnDefs})`);
    return;
  }
  const names = columns.map((c) => c.split(/\s+/)[0]!);
  const values = rows
    .map((row) => `(${row.map((v) => sqlLiteral(v)).join(", ")})`)
    .join(",\n");
  await store.run(`CREATE TABLE ${table} (${columnDefs})`);
  await store.run(`INSERT INTO ${table} (${names.join(", ")}) VALUES\n${values}`);
}

async function distinctValues(
  store: RoadStore,
  table: string,
  column: string,
): Promise<(string | null)[]> {
  const rows = await store.all<{ v: string | null }>(
    `SELECT DISTINCT ${column} AS v FROM ${table}`,
  );
  return rows.map((r) => r.v);
}

/** Maintenance levels, mapped once per distinct raw value. */
async function buildMaintLevelLookup(store: RoadStore): Promise<number> {
  const raw = new Set<string | null>();
  for (const v of await distinctValues(store, "raw_roadcore", "OPER_MAINT_LEVEL")) raw.add(v);
  for (const v of await distinctValues(store, "raw_mvum", "OPERATIONALMAINTLEVEL")) raw.add(v);
  const rows = [...raw].map((value) => {
    const level = parseMaintenanceLevel(value);
    const vehicle = vehicleRequirementFromMaintenanceLevel(level);
    return [
      value,
      level,
      level === null ? null : MAINT_LEVEL_NUMBER[level],
      vehicle,
      vehicle === null ? null : VEHICLE_RANK[vehicle],
    ];
  });
  await createLookup(
    store,
    "map_maint_level",
    [
      "raw VARCHAR",
      "maint_level VARCHAR",
      "maint_level_num INTEGER",
      "vehicle_requirement VARCHAR",
      "vehicle_rank INTEGER",
    ],
    rows,
  );
  return rows.length;
}

/** Surface types, mapped once per distinct raw value across all three sources. */
async function buildSurfaceLookup(store: RoadStore): Promise<number> {
  const federal = new Set<string | null>();
  for (const v of await distinctValues(store, "raw_roadcore", "SURFACE_TYPE")) federal.add(v);
  for (const v of await distinctValues(store, "raw_mvum", "SURFACETYPE")) federal.add(v);
  const federalRows = [...federal].map((value) => {
    const surface = parseSurfaceType(value);
    return [value, surface, surface === null ? null : SURFACE_RANK[surface]];
  });
  await createLookup(
    store,
    "map_surface",
    ["raw VARCHAR", "surface VARCHAR", "surface_rank INTEGER"],
    federalRows,
  );

  const blmRows = (await distinctValues(store, "raw_blm", "OBSRVE_SRFCE_TYPE")).map((value) => {
    const surface = normalizeBlmSurface(value);
    return [value, surface, surface === null ? null : SURFACE_RANK[surface]];
  });
  await createLookup(
    store,
    "map_blm_surface",
    ["raw VARCHAR", "surface VARCHAR", "surface_rank INTEGER"],
    blmRows,
  );
  return federalRows.length + blmRows.length;
}

/** The RoadCore open/closed split, one row per distinct audience/level pair. */
async function buildPublicMotorizedLookup(store: RoadStore): Promise<number> {
  const pairs = await store.all<{ audience: string | null; level: string | null }>(
    `SELECT DISTINCT OPENFORUSETO AS audience, OPER_MAINT_LEVEL AS level FROM raw_roadcore`,
  );
  const rows = pairs.map((p) => [p.audience, p.level, isPublicMotorized(p.audience, p.level)]);
  await createLookup(
    store,
    "map_roadcore_public",
    ["audience VARCHAR", "maint_raw VARCHAR", "public_motorized BOOLEAN"],
    rows,
  );
  return rows.length;
}

/** A class value the reviewed map cannot answer for, and why. */
export interface BlmClassGap {
  raw: string | null;
  rows: number;
  /** `unmapped` — no such class in the map. `no_drivable_flag` — class but no verdict. */
  reason: "unmapped" | "no_drivable_flag";
}

interface BlmClassStats {
  mapped: number;
  gaps: BlmClassGap[];
}

/** The reviewed BLM class map, applied to every distinct observed value. */
async function buildBlmClassLookup(
  store: RoadStore,
  map: RouteUseClassMap,
): Promise<BlmClassStats> {
  const counts = await store.all<{ v: string | null; n: unknown }>(
    `SELECT OBSRVE_ROUTE_USE_CLASS AS v, count(*) AS n FROM raw_blm GROUP BY 1`,
  );
  const gaps: BlmClassGap[] = [];
  const rows = counts.map(({ v, n }) => {
    const result = applyRouteUseClass(map, v);
    // Both gaps are the same hazard — a value nobody reviewed silently
    // deciding what a road is — so both are reported the same way.
    if (result.match === "unmapped") {
      gaps.push({ raw: v, rows: toCount(n), reason: "unmapped" });
    } else if (result.drivable === null) {
      gaps.push({ raw: v, rows: toCount(n), reason: "no_drivable_flag" });
    }
    const vehicle = vehicleRequirementFromBlmClass(result.routeClass);
    return [
      v,
      result.routeClass,
      result.match,
      vehicle,
      vehicle === null ? null : VEHICLE_RANK[vehicle],
    ];
  });
  await createLookup(
    store,
    "map_blm_route_class",
    [
      "raw VARCHAR",
      "route_class VARCHAR",
      "match VARCHAR",
      "vehicle_requirement VARCHAR",
      "vehicle_rank INTEGER",
    ],
    rows,
  );
  return { mapped: rows.length, gaps };
}

/**
 * Which BLM routes belong in the drivable graph, one row per distinct
 * class/allowed-mode pair. Returns how many source rows each reason excluded so
 * the run can report exactly what it dropped and why.
 */
async function buildBlmDrivableLookup(
  store: RoadStore,
  map: RouteUseClassMap,
): Promise<Record<NotDrivableReason, number>> {
  const pairs = await store.all<{ route_class: string | null; modes: string | null; n: unknown }>(
    `SELECT OBSRVE_ROUTE_USE_CLASS AS route_class,
            PLAN_ALLOW_MODE_TRNSPRT AS modes, count(*) AS n
     FROM raw_blm GROUP BY 1, 2`,
  );
  const excluded: Record<NotDrivableReason, number> = {
    route_class: 0,
    allowed_modes: 0,
    unreviewed_class: 0,
  };
  const rows = pairs.map((pair) => {
    const verdict = classifyBlmDrivability(map, pair.route_class, pair.modes);
    if (verdict.reason !== null) excluded[verdict.reason] += toCount(pair.n);
    return [pair.route_class, pair.modes, verdict.drivable, verdict.reason];
  });
  await createLookup(
    store,
    "map_blm_drivable",
    [
      "route_class_raw VARCHAR",
      "allowed_modes_raw VARCHAR",
      "drivable BOOLEAN",
      "not_drivable_reason VARCHAR",
    ],
    rows,
  );
  return excluded;
}

/** The `seasonal` column, cleaned once per distinct raw value. */
async function buildSeasonalLookup(store: RoadStore): Promise<number> {
  const rows = (await distinctValues(store, "raw_mvum", "SEASONAL")).map((value) => [
    value,
    normalizeSeasonalFlag(value),
  ]);
  await createLookup(
    store,
    "map_seasonal",
    ["raw VARCHAR", "seasonal VARCHAR"],
    rows,
  );
  return rows.length;
}

/** The BLM seasonal-restriction flag, which carries no dates. */
async function buildBlmSeasonLookup(store: RoadStore): Promise<number> {
  const rows = (await distinctValues(store, "raw_blm", "PLAN_SEASON_RSTRCT_CODE")).map(
    (value) => [value, normalizeBlmSeasonRestriction(value)],
  );
  await createLookup(
    store,
    "map_blm_season",
    ["raw VARCHAR", "season_restricted BOOLEAN"],
    rows,
  );
  return rows.length;
}

/**
 * Parse every distinct `*_datesopen` string once.
 *
 * Only values that yield a real window reach the table, so the join that
 * builds `mvum_season_window` cannot produce a full-year row. The seasonal
 * gate itself is the join to `map_seasonal`.
 */
async function buildWindowLookup(store: RoadStore): Promise<{
  distinctValues: number;
  usableValues: number;
}> {
  const raw = new Set<string | null>();
  for (const vehicleClass of MVUM_VEHICLE_CLASSES) {
    for (const v of await distinctValues(store, "raw_mvum", vehicleClass.datesField)) raw.add(v);
  }
  const rows: (string | number | boolean | null)[][] = [];
  let usable = 0;
  for (const value of raw) {
    const windows = seasonWindowsForClass("seasonal", value);
    if (windows === null) continue;
    usable += 1;
    windows.forEach((window, index) => {
      rows.push([value, index, window.opens, window.closes, window.wrapsYear]);
    });
  }
  await createLookup(
    store,
    "map_season_window",
    [
      "raw VARCHAR",
      "window_index INTEGER",
      "opens VARCHAR",
      "closes VARCHAR",
      "wraps_year BOOLEAN",
    ],
    rows,
  );
  return { distinctValues: raw.size, usableValues: usable };
}

/**
 * Build the unified segment table.
 *
 * RoadCore and BLM share it because they are the two sources with drivable
 * geometry and a vehicle signal. MVUM stays in its own table: its geometry
 * repeats RoadCore's, so putting it in the graph would double every forest
 * road. It joins on as an attribute overlay instead.
 */
async function buildRoadSegments(store: RoadStore): Promise<void> {
  await store.run("DROP TABLE IF EXISTS road_segment");
  await store.run(`CREATE TABLE road_segment AS
    SELECT
      'usfs_roadcore:' || r.GLOBALID AS segment_key,
      'usfs_roadcore' AS source,
      r.GLOBALID AS source_id,
      r.RTE_CN AS route_cn,
      r.ID AS route_id,
      r.NAME AS name,
      r.ADMIN_ORG AS admin_unit,
      NULL::VARCHAR AS state_code,
      r.BMP AS begin_milepost,
      r.EMP AS end_milepost,
      coalesce(p.public_motorized, FALSE) AS public_motorized,
      ml.maint_level,
      ml.maint_level_num,
      NULL::VARCHAR AS blm_route_class,
      ml.vehicle_requirement,
      ml.vehicle_rank,
      s.surface,
      s.surface_rank,
      NULL::BOOLEAN AS season_restricted,
      r.GIS_MILES AS length_miles,
      r.geom_kind,
      r.geom
    FROM raw_roadcore r
    LEFT JOIN map_roadcore_public p
      ON p.audience IS NOT DISTINCT FROM r.OPENFORUSETO
     AND p.maint_raw IS NOT DISTINCT FROM r.OPER_MAINT_LEVEL
    LEFT JOIN map_maint_level ml ON ml.raw IS NOT DISTINCT FROM r.OPER_MAINT_LEVEL
    LEFT JOIN map_surface s ON s.raw IS NOT DISTINCT FROM r.SURFACE_TYPE
    UNION ALL
    SELECT
      'blm_gtlf:' || b.OBJECTID::VARCHAR AS segment_key,
      'blm_gtlf' AS source,
      b.OBJECTID::VARCHAR AS source_id,
      NULL::VARCHAR AS route_cn,
      b.ROUTE_PLAN_ID AS route_id,
      b.ROUTE_PRMRY_NM AS name,
      b.TMA_ID AS admin_unit,
      b.ADMIN_ST AS state_code,
      NULL::DOUBLE AS begin_milepost,
      NULL::DOUBLE AS end_milepost,
      coalesce(d.drivable, FALSE) AS public_motorized,
      NULL::VARCHAR AS maint_level,
      NULL::INTEGER AS maint_level_num,
      c.route_class AS blm_route_class,
      c.vehicle_requirement,
      c.vehicle_rank,
      s.surface,
      s.surface_rank,
      se.season_restricted,
      b.GIS_MILES AS length_miles,
      b.geom_kind,
      b.geom
    FROM raw_blm b
    LEFT JOIN map_blm_route_class c ON c.raw IS NOT DISTINCT FROM b.OBSRVE_ROUTE_USE_CLASS
    LEFT JOIN map_blm_surface s ON s.raw IS NOT DISTINCT FROM b.OBSRVE_SRFCE_TYPE
    LEFT JOIN map_blm_season se ON se.raw IS NOT DISTINCT FROM b.PLAN_SEASON_RSTRCT_CODE
    LEFT JOIN map_blm_drivable d
      ON d.route_class_raw IS NOT DISTINCT FROM b.OBSRVE_ROUTE_USE_CLASS
     AND d.allowed_modes_raw IS NOT DISTINCT FROM b.PLAN_ALLOW_MODE_TRNSPRT`);

  // The graph carries what a driver may use and what we can place on a map.
  await store.run("ALTER TABLE road_segment ADD COLUMN in_graph BOOLEAN");
  await store.run(`UPDATE road_segment
    SET in_graph = (public_motorized AND geom IS NOT NULL)`);
}

/** MVUM segments, normalized, with their link back to RoadCore by route. */
async function buildMvumSegments(store: RoadStore): Promise<void> {
  await store.run("DROP TABLE IF EXISTS mvum_segment");
  await store.run(`CREATE TABLE mvum_segment AS
    SELECT
      'usfs_mvum:' || m.GLOBALID AS mvum_key,
      m.GLOBALID AS source_id,
      m.RTE_CN AS route_cn,
      m.ID AS route_id,
      m.NAME AS name,
      m.FORESTNAME AS forest_name,
      m.DISTRICTNAME AS district_name,
      m.BMP AS begin_milepost,
      m.EMP AS end_milepost,
      sf.seasonal,
      ml.maint_level,
      ml.maint_level_num,
      s.surface,
      s.surface_rank,
      m.GIS_MILES AS length_miles,
      m.geom_kind,
      m.geom
    FROM raw_mvum m
    LEFT JOIN map_seasonal sf ON sf.raw IS NOT DISTINCT FROM m.SEASONAL
    LEFT JOIN map_maint_level ml ON ml.raw IS NOT DISTINCT FROM m.OPERATIONALMAINTLEVEL
    LEFT JOIN map_surface s ON s.raw IS NOT DISTINCT FROM m.SURFACETYPE`);
}

/**
 * The seasonal windows, one row per segment, class and window.
 *
 * Two joins carry the §A3 rules: `map_seasonal` admits only rows flagged
 * seasonal, and `map_season_window` holds only date strings that describe
 * something narrower than the whole year.
 */
async function buildSeasonWindows(store: RoadStore): Promise<void> {
  const selects = MVUM_VEHICLE_CLASSES.map(
    (vehicleClass) => `SELECT
      'usfs_mvum:' || m.GLOBALID AS mvum_key,
      ${sqlLiteral(vehicleClass.name)} AS vehicle_class,
      w.window_index, w.opens, w.closes, w.wraps_year
    FROM raw_mvum m
    JOIN map_seasonal sf
      ON sf.raw IS NOT DISTINCT FROM m.SEASONAL AND sf.seasonal = 'seasonal'
    JOIN map_season_window w ON w.raw IS NOT DISTINCT FROM m.${vehicleClass.datesField}`,
  ).join("\nUNION ALL\n");
  await store.run("DROP TABLE IF EXISTS mvum_season_window");
  await store.run(`CREATE TABLE mvum_season_window AS ${selects}`);
}

/**
 * Link MVUM segments to the open RoadCore segments they describe.
 *
 * `RTE_CN` names the route, not the segment — 31,087 RoadCore route numbers
 * repeat — so the link also needs the mileposts to overlap. That pairs an MVUM
 * segment with the RoadCore segments covering the same stretch of road.
 */
async function buildRoadcoreMvumLink(store: RoadStore): Promise<void> {
  await store.run("DROP TABLE IF EXISTS roadcore_mvum_link");
  await store.run(`CREATE TABLE roadcore_mvum_link AS
    SELECT
      r.segment_key AS roadcore_key,
      m.mvum_key,
      least(r.end_milepost, m.end_milepost)
        - greatest(r.begin_milepost, m.begin_milepost) AS overlap_miles
    FROM road_segment r
    JOIN mvum_segment m ON m.route_cn = r.route_cn
    WHERE r.source = 'usfs_roadcore'
      AND r.public_motorized
      AND r.begin_milepost IS NOT NULL AND r.end_milepost IS NOT NULL
      AND m.begin_milepost IS NOT NULL AND m.end_milepost IS NOT NULL
      AND least(r.end_milepost, m.end_milepost)
          - greatest(r.begin_milepost, m.begin_milepost) > 0`);
}

interface TopologyStats {
  parts: number;
  junctionCandidates: number;
  splitPoints: number;
  edges: number;
  nodes: number;
  edgesWithoutLength: number;
  isolatedEdges: number;
  components: number;
  anchoredComponents: number;
  anchoredNodes: number;
}

/**
 * How much of the graph can actually reach a stopping point.
 *
 * This is the number the traversal task starts from, and it is not the same as
 * how connected the graph looks. A component with no maintenance level 4 or 5
 * edge in it has no anchor: a walk inside it runs to the end and returns
 * nothing, however large and well-connected the component is.
 */
function measureAnchorReach(
  edges: readonly { from_node: number; to_node: number; approach_terminus: unknown }[],
): { components: number; anchoredComponents: number; anchoredNodes: number } {
  const parent = new Map<number, number>();
  const find = (node: number): number => {
    let root = node;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let walk = node;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk)!;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  const add = (node: number): void => {
    if (!parent.has(node)) parent.set(node, node);
  };
  for (const edge of edges) {
    add(edge.from_node);
    add(edge.to_node);
    const a = find(edge.from_node);
    const b = find(edge.to_node);
    if (a !== b) parent.set(a, b);
  }
  const anchored = new Set<number>();
  for (const edge of edges) {
    if (edge.approach_terminus === true) anchored.add(find(edge.from_node));
  }
  const components = new Set<number>();
  let anchoredNodes = 0;
  for (const node of parent.keys()) {
    const root = find(node);
    components.add(root);
    if (anchored.has(root)) anchoredNodes += 1;
  }
  return { components: components.size, anchoredComponents: anchored.size, anchoredNodes };
}

// Cell size for the coarse grid that pairs road vertices with junction
// candidates, as a multiple of the snap tolerance. Anything at or above one
// tolerance is correct; four leaves room for the shorter degree of longitude
// at high latitude, at the cost of a few more candidate pairs to measure.
const GRID_CELL_FACTOR = 4;

/** How many segment parts the piece-reassembly step handles at a time. */
const EDGE_CHUNK_SIZE = 20_000;

/** Read one edge table's endpoints in edge order, ready for clustering. */
async function readEndpoints(
  store: RoadStore,
  table: string,
): Promise<{ edgeIds: string[]; endpoints: Endpoint[] }> {
  const rows = await store.all<{
    edge_id: string;
    start_lon: number;
    start_lat: number;
    end_lon: number;
    end_lat: number;
  }>(`SELECT edge_id, start_lon, start_lat, end_lon, end_lat FROM ${table} ORDER BY edge_id`);
  const edgeIds: string[] = new Array(rows.length);
  const endpoints: Endpoint[] = new Array(rows.length * 2);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    edgeIds[i] = row.edge_id;
    endpoints[i * 2] = { lon: row.start_lon, lat: row.start_lat };
    endpoints[i * 2 + 1] = { lon: row.end_lon, lat: row.end_lat };
  }
  return { edgeIds, endpoints };
}

/** Write clustered node positions into a table of (node_id, lon, lat, count). */
async function writeNodes(
  store: RoadStore,
  table: string,
  nodes: readonly { lon: number; lat: number; endpointCount: number }[],
): Promise<void> {
  await store.run(`DROP TABLE IF EXISTS ${table}`);
  await store.run(
    `CREATE TABLE ${table} (node_id INTEGER, lon DOUBLE, lat DOUBLE, endpoint_count INTEGER)`,
  );
  const appender = await store.connection.createAppender(table);
  nodes.forEach((node, index) => {
    appender.appendInteger(index);
    appender.appendDouble(node.lon);
    appender.appendDouble(node.lat);
    appender.appendInteger(node.endpointCount);
    appender.endRow();
  });
  appender.closeSync();
}

/**
 * Cut every graph segment into edges that meet at shared nodes.
 *
 * Snapping segment endpoints alone is not enough, and the failure is quiet: a
 * spur that joins the middle of a forest road shares no endpoint with it, so
 * an endpoint-only graph leaves both sides dangling. Measured on this data
 * that graph came apart into 165,323 pieces, the largest holding four tenths
 * of a percent of the nodes — useless for a walk that has to reach a
 * maintenance level 4 road. So the build has three steps:
 *
 *   1. Snap the segment endpoints together. Those positions are where roads
 *      are known to meet.
 *   2. Split any segment that passes within the tolerance of one of those
 *      positions, at the vertex that comes closest. That turns a T-junction
 *      into a real node.
 *   3. Snap the endpoints of the split edges. A spur that stopped a few metres
 *      short of the through road now merges with the node the split created.
 *
 * Step 2 measures 25 million road vertices against 440,000 junction positions,
 * which is far too much to bring into JavaScript, so DuckDB buckets them on a
 * plain integer grid and measures the pairs with the same formula
 * `metresBetween` uses. What this still misses is a crossroads where neither
 * road ends and neither carries a vertex at the crossing.
 *
 * Length comes from the agency's own `GIS_MILES`, split between the edges of a
 * segment in proportion to their plane length. DuckDB's spheroid length
 * function returns nonsense in this build, and the agency figure is the one a
 * user should see quoted anyway.
 */
async function buildTopology(
  store: RoadStore,
  toleranceMetres: number,
): Promise<TopologyStats> {
  await store.run("DROP TABLE IF EXISTS road_edge_part");
  await store.run(`CREATE TABLE road_edge_part AS
    SELECT
      row_number() OVER () AS edge_index,
      segment_key || '#' || part_index::VARCHAR AS edge_id,
      segment_key,
      part_index,
      geom,
      ST_NPoints(geom::LINESTRING_2D) AS npoints,
      ST_X(ST_StartPoint(geom::LINESTRING_2D)) AS start_lon,
      ST_Y(ST_StartPoint(geom::LINESTRING_2D)) AS start_lat,
      ST_X(ST_EndPoint(geom::LINESTRING_2D)) AS end_lon,
      ST_Y(ST_EndPoint(geom::LINESTRING_2D)) AS end_lat
    FROM (
      SELECT segment_key, part.path[1] AS part_index, part.geom AS geom
      FROM (SELECT segment_key, unnest(ST_Dump(geom)) AS part
            FROM road_segment WHERE in_graph)
    )`);
  const partCount = toCount(
    (await store.one<{ n: unknown }>("SELECT count(*) AS n FROM road_edge_part")).n,
  );

  // Every vertex of every graph edge, as plain numbers. Twenty-five million
  // rows, so it is keyed by an integer rather than the edge id, computed once
  // here and used by both the split search and the rebuild.
  await store.run("DROP TABLE IF EXISTS road_edge_vertex");
  await store.run(`CREATE TABLE road_edge_vertex AS
    SELECT edge_index, d.path[1] AS vertex_index,
           ST_X(d.geom::POINT_2D) AS lon, ST_Y(d.geom::POINT_2D) AS lat
    FROM (SELECT edge_index, unnest(ST_Dump(ST_Points(geom))) AS d
          FROM road_edge_part)`);

  // Step 1: where do segment endpoints already meet?
  const firstPass = await readEndpoints(store, "road_edge_part");
  const junctions = clusterEndpoints(firstPass.endpoints, toleranceMetres);
  await writeNodes(store, "topology_junction", junctions.nodes);

  // Step 2: split a segment wherever it passes one of those positions.
  const cell = (GRID_CELL_FACTOR * toleranceMetres) / 111_320;
  await store.run("DROP TABLE IF EXISTS topology_junction_cell");
  await store.run(`CREATE TABLE topology_junction_cell AS
    SELECT node_id, lon, lat,
           CAST(floor(lat / ${cell}) AS BIGINT) + dr AS r,
           CAST(floor(lon / ${cell}) AS BIGINT) + dc AS c
    FROM topology_junction,
         (VALUES (-1), (0), (1)) AS a(dr),
         (VALUES (-1), (0), (1)) AS b(dc)`);

  // One split per junction, at the vertex that comes closest to it. Splitting
  // at every vertex inside the tolerance instead would cut a road into stubs
  // shorter than the tolerance, and both ends of a stub then snap to the same
  // node — a graph of half a million self-loops. A junction that falls within
  // the tolerance of the edge's own start or end needs no split at all: the
  // endpoint snapping already joins those.
  const distance = metresBetweenSql("v.lon", "v.lat", "j.lon", "j.lat");
  const toStart = metresBetweenSql("v.lon", "v.lat", "p.start_lon", "p.start_lat");
  const toEnd = metresBetweenSql("v.lon", "v.lat", "p.end_lon", "p.end_lat");
  await store.run("DROP TABLE IF EXISTS road_split_point");
  await store.run(`CREATE TABLE road_split_point AS
    WITH near AS (
      SELECT v.edge_index, v.vertex_index, j.node_id, ${distance} AS metres
      FROM road_edge_vertex v
      JOIN road_edge_part p USING (edge_index)
      JOIN topology_junction_cell j
        ON j.r = CAST(floor(v.lat / ${cell}) AS BIGINT)
       AND j.c = CAST(floor(v.lon / ${cell}) AS BIGINT)
      WHERE v.vertex_index > 1
        AND v.vertex_index < p.npoints
        AND ${distance} <= ${toleranceMetres}
        AND ${toStart} > ${toleranceMetres}
        AND ${toEnd} > ${toleranceMetres}
    ), closest AS (
      SELECT edge_index, node_id, vertex_index,
             row_number() OVER (PARTITION BY edge_index, node_id
                                ORDER BY metres, vertex_index) AS rank
      FROM near
    )
    SELECT DISTINCT edge_index, vertex_index FROM closest WHERE rank = 1`);
  const splitCount = toCount(
    (await store.one<{ n: unknown }>("SELECT count(*) AS n FROM road_split_point")).n,
  );

  await store.run("DROP TABLE IF EXISTS road_edge_piece");
  await store.run(`CREATE TABLE road_edge_piece AS
    WITH split_edges AS (SELECT DISTINCT edge_index FROM road_split_point),
    marked AS (
      SELECT v.edge_index, v.vertex_index, v.lon, v.lat,
             CASE WHEN s.edge_index IS NULL THEN 0 ELSE 1 END AS is_split
      FROM road_edge_vertex v
      JOIN split_edges e USING (edge_index)
      LEFT JOIN road_split_point s
        ON s.edge_index = v.edge_index AND s.vertex_index = v.vertex_index
    ),
    numbered AS (
      SELECT *, sum(is_split) OVER (
                  PARTITION BY edge_index ORDER BY vertex_index
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS piece
      FROM marked
    )
    -- A split vertex ends one piece and starts the next, so it is in both.
    SELECT edge_index, piece, vertex_index, lon, lat FROM numbered
    UNION ALL
    SELECT edge_index, piece - 1, vertex_index, lon, lat FROM numbered WHERE is_split = 1`);

  // Reassembling the pieces means an ordered list aggregate over twenty-two
  // million points, which DuckDB holds in memory rather than spilling. Doing
  // it a slice of edges at a time keeps the peak flat; the slices are cut on
  // edge boundaries, so no piece is ever split across two of them.
  await store.run("DROP TABLE IF EXISTS road_edge_geom");
  await store.run(`CREATE TABLE road_edge_geom (
    edge_id VARCHAR, segment_key VARCHAR, part_index INTEGER, geom GEOMETRY,
    plane_length DOUBLE, start_lon DOUBLE, start_lat DOUBLE,
    end_lon DOUBLE, end_lat DOUBLE)`);
  for (let first = 1; first <= partCount; first += EDGE_CHUNK_SIZE) {
    const last = first + EDGE_CHUNK_SIZE - 1;
    await store.run(`INSERT INTO road_edge_geom
      WITH built AS (
        SELECT edge_index, piece,
               ST_MakeLine(list(ST_Point(lon, lat) ORDER BY vertex_index)) AS geom
        FROM road_edge_piece
        WHERE edge_index BETWEEN ${first} AND ${last}
        GROUP BY edge_index, piece HAVING count(*) >= 2
      ),
      combined AS (
        SELECT p.segment_key, p.part_index,
               p.edge_id || '@' || b.piece::VARCHAR AS edge_id,
               b.geom
        FROM built b JOIN road_edge_part p USING (edge_index)
        UNION ALL
        SELECT p.segment_key, p.part_index, p.edge_id, p.geom
        FROM road_edge_part p
        WHERE p.edge_index BETWEEN ${first} AND ${last}
          AND NOT EXISTS (SELECT 1 FROM road_split_point s
                           WHERE s.edge_index = p.edge_index)
      )
      SELECT edge_id, segment_key, part_index::INTEGER, geom,
             ST_Length(geom) AS plane_length,
             ST_X(ST_StartPoint(geom::LINESTRING_2D)) AS start_lon,
             ST_Y(ST_StartPoint(geom::LINESTRING_2D)) AS start_lat,
             ST_X(ST_EndPoint(geom::LINESTRING_2D)) AS end_lon,
             ST_Y(ST_EndPoint(geom::LINESTRING_2D)) AS end_lat
      FROM combined`);
  }

  // Step 3: snap the endpoints of the split edges into the final nodes.
  const secondPass = await readEndpoints(store, "road_edge_geom");
  const clustered = clusterEndpoints(secondPass.endpoints, toleranceMetres);
  await writeNodes(store, "road_node", clustered.nodes);
  await store.run("ALTER TABLE road_node ADD COLUMN geom GEOMETRY");
  await store.run("UPDATE road_node SET geom = ST_Point(lon, lat)");

  await store.run("DROP TABLE IF EXISTS road_edge_node");
  await store.run(
    "CREATE TABLE road_edge_node (edge_id VARCHAR, from_node INTEGER, to_node INTEGER)",
  );
  const edgeAppender = await store.connection.createAppender("road_edge_node");
  for (let i = 0; i < secondPass.edgeIds.length; i += 1) {
    edgeAppender.appendVarchar(secondPass.edgeIds[i]!);
    edgeAppender.appendInteger(clustered.nodeIdByEndpoint[i * 2]!);
    edgeAppender.appendInteger(clustered.nodeIdByEndpoint[i * 2 + 1]!);
    edgeAppender.endRow();
  }
  edgeAppender.closeSync();

  await store.run("DROP TABLE IF EXISTS road_edge");
  await store.run(`CREATE TABLE road_edge AS
    SELECT
      g.edge_id,
      g.segment_key,
      g.part_index,
      n.from_node,
      n.to_node,
      CASE WHEN sum(g.plane_length) OVER (PARTITION BY g.segment_key) > 0
        THEN s.length_miles * g.plane_length
             / sum(g.plane_length) OVER (PARTITION BY g.segment_key)
      END AS length_miles,
      s.source,
      s.route_id,
      s.name,
      s.admin_unit,
      s.state_code,
      s.maint_level,
      s.maint_level_num,
      s.blm_route_class,
      s.vehicle_requirement,
      s.vehicle_rank,
      s.surface,
      s.surface_rank,
      s.season_restricted,
      -- Where the approach walk may stop: a road built for passenger comfort.
      -- State highways are not in these sources; adding TIGER would extend it.
      (s.maint_level_num >= 4) AS approach_terminus,
      g.geom
    FROM road_edge_geom g
    JOIN road_edge_node n USING (edge_id)
    JOIN road_segment s USING (segment_key)`);
  await store.run("CREATE INDEX road_edge_geom_idx ON road_edge USING RTREE (geom)");
  await store.run("CREATE INDEX road_edge_from_idx ON road_edge (from_node)");
  await store.run("CREATE INDEX road_edge_to_idx ON road_edge (to_node)");

  // Staging tables the traversal task does not need.
  for (const table of [
    "topology_junction",
    "topology_junction_cell",
    "road_edge_vertex",
    "road_edge_piece",
    "road_edge_geom",
  ]) {
    await store.run(`DROP TABLE IF EXISTS ${table}`);
  }

  const stats = await store.one<{ edges: unknown; no_length: unknown; isolated: unknown }>(
    `SELECT count(*) AS edges,
            sum(CASE WHEN length_miles IS NULL THEN 1 ELSE 0 END) AS no_length,
            sum(CASE WHEN from_node = to_node THEN 1 ELSE 0 END) AS isolated
     FROM road_edge`,
  );
  const reach = measureAnchorReach(
    await store.all<{ from_node: number; to_node: number; approach_terminus: unknown }>(
      "SELECT from_node, to_node, approach_terminus FROM road_edge",
    ),
  );
  return {
    parts: partCount,
    junctionCandidates: junctions.nodes.length,
    splitPoints: splitCount,
    edges: toCount(stats.edges),
    nodes: clustered.nodes.length,
    edgesWithoutLength: toCount(stats.no_length),
    isolatedEdges: toCount(stats.isolated),
    ...reach,
  };
}

/** One provenance row per source file, so a store can say where it came from. */
async function recordRun(
  store: RoadStore,
  entries: { dataset: string; sourcePath: string; rows: number }[],
): Promise<void> {
  await store.run(`CREATE TABLE IF NOT EXISTS road_load_run (
    dataset VARCHAR, source_path VARCHAR, source_bytes BIGINT,
    rows_loaded BIGINT, loaded_at TIMESTAMP)`);
  for (const entry of entries) {
    const bytes = existsSync(entry.sourcePath) ? statSync(entry.sourcePath).size : 0;
    await store.run(`DELETE FROM road_load_run WHERE dataset = ${sqlLiteral(entry.dataset)}`);
    await store.run(`INSERT INTO road_load_run VALUES (
      ${sqlLiteral(entry.dataset)}, ${sqlLiteral(entry.sourcePath)}, ${bytes},
      ${entry.rows}, now()::TIMESTAMP)`);
  }
}

function compare(label: string, actual: number, expected: number): string {
  const delta = actual - expected;
  const drift = delta === 0 ? "matches" : `${delta > 0 ? "+" : ""}${delta} vs expected`;
  return `${label}: ${actual.toLocaleString()} (${drift} ${expected.toLocaleString()})`;
}

export async function importRoadNetwork(args: Args): Promise<void> {
  if (!args.dataDir) {
    throw new Error("--data-dir is required (the peaks docs/trailheads/data directory)");
  }
  const dataDir = path.resolve(args.dataDir);
  const paths = sourcePaths(dataDir, args.routeUseClassMapPath);
  for (const required of [paths.roadcoreZip, paths.mvumZip, paths.blm, paths.routeUseClassMap]) {
    if (!existsSync(required)) throw new Error(`missing input: ${required}`);
  }
  const storePath = path.resolve(args.storePath ?? defaultStorePath(dataDir));
  mkdirSync(path.dirname(storePath), { recursive: true });

  const run = new Set<Stage>(args.stages);
  // A full run rebuilds the store from the source files, so it starts from an
  // empty file. DuckDB never gives space back after a DROP, and the staging
  // tables are large; reusing the old file would leave several spare gigabytes
  // behind on every refresh.
  if (run.size === STAGES.length && existsSync(storePath)) {
    rmSync(storePath, { force: true });
    rmSync(`${storePath}.wal`, { force: true });
    rmSync(`${storePath}.tmp`, { force: true, recursive: true });
    console.log("removed the previous store — a full run rebuilds it");
  }
  const store = await openRoadStore(storePath, {
    memoryLimit: args.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
  });
  const started = Date.now();
  try {
    await store.run("SET preserve_insertion_order = false");
    console.log(`store: ${storePath}`);

    const loaded: { dataset: string; sourcePath: string; rows: number }[] = [];
    if (run.has("roadcore")) {
      const rows = await loadGeodatabase(store, "raw_roadcore", paths.roadcore);
      loaded.push({ dataset: "usfs_roadcore", sourcePath: paths.roadcoreZip, rows });
      console.log(compare("  usfs_roadcore rows", rows, EXPECTED_ROW_COUNTS.roadcore_total));
    }
    if (run.has("mvum")) {
      const rows = await loadGeodatabase(store, "raw_mvum", paths.mvum);
      loaded.push({ dataset: "usfs_mvum", sourcePath: paths.mvumZip, rows });
      console.log(compare("  usfs_mvum rows", rows, EXPECTED_ROW_COUNTS.mvum));
    }
    if (run.has("blm")) {
      const rows = await loadBlm(store, paths.blm);
      loaded.push({ dataset: "blm_gtlf", sourcePath: paths.blm, rows });
      console.log(compare("  blm_gtlf rows", rows, EXPECTED_ROW_COUNTS.blm));
    }
    if (loaded.length > 0) await recordRun(store, loaded);

    if (run.has("normalize")) {
      console.log("normalizing");
      const levels = await buildMaintLevelLookup(store);
      const surfaces = await buildSurfaceLookup(store);
      const audiences = await buildPublicMotorizedLookup(store);
      const routeUseClassMap = parseRouteUseClassMap(
        await readFile(paths.routeUseClassMap, "utf8"),
      );
      const blmClasses = await buildBlmClassLookup(store, routeUseClassMap);
      const blmExcluded = await buildBlmDrivableLookup(store, routeUseClassMap);
      await buildBlmSeasonLookup(store);
      await buildSeasonalLookup(store);
      console.log(
        `  value maps: ${levels} maintenance levels, ${surfaces} surfaces, ` +
          `${audiences} audience/level pairs, ${blmClasses.mapped} BLM classes`,
      );
      console.log(
        `  BLM routes excluded as not drivable: ` +
          `${blmExcluded.route_class.toLocaleString()} by reviewed class, ` +
          `${blmExcluded.allowed_modes.toLocaleString()} by allowed mode, ` +
          `${blmExcluded.unreviewed_class.toLocaleString()} unreviewed`,
      );
      // A class the map does not answer for decides what counts as a road on
      // nobody's authority, whether it is missing outright or merely missing
      // its verdict. Both are the same hazard and get the same warning.
      if (blmClasses.gaps.length > 0) {
        console.log(
          `  WARNING BLM route-use-class values the reviewed map cannot answer for. ` +
            `They are kept OUT of the drivable graph until reviewed — add them to ` +
            `${paths.routeUseClassMap} with a canonical_class and a drivable flag:`,
        );
        for (const gap of blmClasses.gaps) {
          const why =
            gap.reason === "unmapped" ? "not in the map" : "no drivable flag on its map row";
          console.log(
            `    ${JSON.stringify(gap.raw)} — ${gap.rows.toLocaleString()} rows — ${why}`,
          );
        }
      }
      await buildRoadSegments(store);
      await buildMvumSegments(store);

      const segments = await store.one<{
        total: unknown;
        open_roadcore: unknown;
        blm_drivable: unknown;
        graph: unknown;
      }>(`SELECT count(*) AS total,
             sum(CASE WHEN source = 'usfs_roadcore' AND public_motorized THEN 1 ELSE 0 END)
               AS open_roadcore,
             sum(CASE WHEN source = 'blm_gtlf' AND public_motorized THEN 1 ELSE 0 END)
               AS blm_drivable,
             sum(CASE WHEN in_graph THEN 1 ELSE 0 END) AS graph
          FROM road_segment`);
      console.log(
        `  road_segment: ${toCount(segments.total).toLocaleString()} rows`,
      );
      console.log(
        "  " + compare(
          "roadcore open to public",
          toCount(segments.open_roadcore),
          EXPECTED_ROW_COUNTS.roadcore_open,
        ),
      );

      // Every row that will not reach the graph, counted where it is dropped
      // rather than left as arithmetic across three separate figures.
      const dropped = await store.all<{ source: string; reason: string; n: unknown }>(
        `SELECT source,
                CASE WHEN NOT public_motorized THEN 'not open to public motor vehicles'
                     WHEN geom_kind = 'missing' THEN 'no geometry in the source'
                     WHEN geom_kind = 'unsupported_curve' THEN 'true-curve geometry unreadable'
                END AS reason,
                count(*) AS n
         FROM road_segment
         WHERE NOT in_graph
         GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
      );
      console.log("  dropped before the graph:");
      for (const row of dropped) {
        console.log(`    ${row.source}: ${toCount(row.n).toLocaleString()} — ${row.reason}`);
      }
      const mvumDropped = await store.all<{ reason: string; n: unknown }>(
        `SELECT geom_kind AS reason, count(*) AS n FROM mvum_segment
         WHERE geom_kind <> 'multilinestring' GROUP BY 1 ORDER BY 2 DESC`,
      );
      for (const row of mvumDropped) {
        console.log(
          `    usfs_mvum: ${toCount(row.n).toLocaleString()} — ${row.reason} ` +
            `(overlay only, never in the graph)`,
        );
      }
      console.log(
        `  graph-eligible segments: ${toCount(segments.graph).toLocaleString()} ` +
          `(${toCount(segments.open_roadcore).toLocaleString()} RoadCore, ` +
          `${toCount(segments.blm_drivable).toLocaleString()} BLM, before geometry drops)`,
      );
    }

    if (run.has("seasons")) {
      const windows = await buildWindowLookup(store);
      await buildSeasonWindows(store);
      const summary = await store.one<{ rows: unknown; segments: unknown; seasonal: unknown }>(
        `SELECT count(*) AS rows, count(DISTINCT mvum_key) AS segments,
                (SELECT count(*) FROM mvum_segment WHERE seasonal = 'seasonal') AS seasonal
         FROM mvum_season_window`,
      );
      console.log(
        `  mvum: ${toCount(summary.seasonal).toLocaleString()} segments flagged seasonal; ` +
          `${toCount(summary.segments).toLocaleString()} carry a real window ` +
          `(${toCount(summary.rows).toLocaleString()} class windows from ` +
          `${windows.usableValues} of ${windows.distinctValues} distinct date strings)`,
      );
    }

    if (run.has("link")) {
      await buildRoadcoreMvumLink(store);
      const link = await store.one<{ links: unknown; mvum: unknown; unlinked: unknown }>(
        `SELECT count(*) AS links, count(DISTINCT mvum_key) AS mvum,
                (SELECT count(*) FROM mvum_segment m
                  WHERE NOT EXISTS (SELECT 1 FROM roadcore_mvum_link l
                                     WHERE l.mvum_key = m.mvum_key)) AS unlinked
         FROM roadcore_mvum_link`,
      );
      console.log(
        `  mvum to roadcore: ${toCount(link.mvum).toLocaleString()} of ` +
          `${EXPECTED_ROW_COUNTS.mvum.toLocaleString()} MVUM segments linked ` +
          `(${toCount(link.links).toLocaleString()} pairs, ` +
          `${toCount(link.unlinked).toLocaleString()} unlinked)`,
      );
    }

    if (run.has("topology")) {
      console.log(`building topology at a ${args.snapToleranceMetres} m snap tolerance`);
      const stats = await buildTopology(store, args.snapToleranceMetres);
      console.log(
        `  ${stats.parts.toLocaleString()} segment parts, ` +
          `${stats.junctionCandidates.toLocaleString()} endpoint junctions, ` +
          `${stats.splitPoints.toLocaleString()} mid-segment splits`,
      );
      console.log(
        `  road_edge: ${stats.edges.toLocaleString()} edges over ` +
          `${stats.nodes.toLocaleString()} nodes ` +
          `(${stats.edgesWithoutLength.toLocaleString()} without a length, ` +
          `${stats.isolatedEdges.toLocaleString()} closed loops)`,
      );
      // The number the traversal task starts from: a walk can only answer
      // inside a component that holds a maintenance level 4 or 5 road.
      const anchoredShare = (100 * stats.anchoredNodes) / Math.max(stats.nodes, 1);
      console.log(
        `  anchor reach: ${stats.anchoredComponents.toLocaleString()} of ` +
          `${stats.components.toLocaleString()} components hold a level 4/5 road, ` +
          `covering ${stats.anchoredNodes.toLocaleString()} nodes ` +
          `(${anchoredShare.toFixed(0)}%)`,
      );
    }

    await store.run("CHECKPOINT");
    console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    store.close();
  }
}

function isDirectRun(scriptPath: string | undefined): boolean {
  return /(?:^|[/\\])import-road-network\.(?:ts|js)$/.test(scriptPath ?? "");
}

if (isDirectRun(process.argv[1])) {
  importRoadNetwork(parseArgs(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
