// The handover to the approach-path traversal.
//
// The walk described in docs/trailheads/research-roads.md §A4 needs two
// things: a way to put a trailhead onto the road graph, and a way to step from
// one edge to the next. Both are here, so the traversal task writes the walk
// and its rules rather than the plumbing.
//
// The shape of the walk, for the task that writes it:
//
//   1. `snapTrailhead(store, { lon, lat })` gives the nearest edges, closest
//      first, with the metres from the trailhead to the edge. A trailhead more
//      than the search radius from any edge has no approach — report it, do
//      not stretch the radius until something matches. The research found a
//      naive 1.3 km box picked the wrong road twice in eight.
//   2. `loadTraversalEdges(store)` reads every edge once; `buildAdjacency`
//      turns them into a node-to-edges map. The whole graph is a few hundred
//      thousand edges, so it fits in memory and needs no database round trip
//      per step.
//   3. Walk outward from the snapped edge's nodes. Stop on an edge with
//      `approachTerminus` — maintenance level 4 or 5, a road built for
//      passenger comfort. State highways are not in these sources, so add
//      TIGER before treating a highway as a stop.
//   4. Summarize the chosen path with `summarizeApproach`, which applies the
//      worst-on-the-path rule and the unknown rule together. Store
//      `limitingSegmentKey` — not the edge id — as the answer's evidence.
//   5. Seasonal windows are not on the edge. Join through
//      `roadcore_mvum_link` to `mvum_season_window` for the segments on the
//      path and intersect the windows. An edge with no window has no seasonal
//      data — never read that as open all year.
//
// Two contracts that are easy to get wrong, and wrong quietly:
//
// **Store the segment key, never the edge id.** An edge id is an artefact of
// this build: 46% of them carry an `@piece` suffix from the noding, and both
// that suffix and the node ids are positional, so a source refresh renumbers
// them. `segmentKey` is `<source>:<GLOBALID or OBJECTID>` — the agency's own
// identifier — and it is what makes a stored answer auditable a year later.
//
// **An unknown edge poisons the whole path.** 55% of BLM edges have no
// `vehicleRank` at all, because BLM's observed class is literally "Unknown" on
// nearly half its network, and 3,071 edges have no length. Taking a plain
// maximum over that silently reports the second-worst *known* edge as if it
// were the answer — §A3's failure mode wearing a different hat. A path holding
// even one unranked edge has an unknown vehicle answer, and a path holding one
// unmeasured edge has an unknown length. `summarizeApproach` enforces both.

import { metresBetween, buildAdjacency, type Endpoint, type GraphEdge } from "./topology";
import { sqlLiteral, type RoadStore } from "./store";

export { buildAdjacency } from "./topology";
export type { Adjacency, Endpoint, GraphEdge } from "./topology";

/** Metres per degree of latitude, as in topology.ts. */
const METRES_PER_DEGREE_LAT = 111_320;

/** Default radius for snapping a trailhead to the road graph. */
export const DEFAULT_SNAP_RADIUS_M = 250;

export interface SnapOptions {
  lon: number;
  lat: number;
  /** Search radius in metres. Defaults to `DEFAULT_SNAP_RADIUS_M`. */
  radiusMetres?: number;
  /** How many candidates to return, closest first. */
  limit?: number;
}

export interface SnapCandidate {
  /** This build's edge id. Positional — never store it as a reference. */
  edgeId: string;
  /** `<source>:<GLOBALID or OBJECTID>`. The durable, auditable reference. */
  segmentKey: string;
  source: string;
  routeId: string | null;
  name: string | null;
  fromNode: number;
  toNode: number;
  /** Metres from the trailhead to the nearest point on the edge. */
  distanceMetres: number;
  /** Where on the edge that point sits, 0 at `fromNode` and 1 at `toNode`. */
  positionAlongEdge: number;
  vehicleRequirement: string | null;
  vehicleRank: number | null;
  surface: string | null;
  surfaceRank: number | null;
  maintLevel: string | null;
  maintLevelNum: number | null;
}

/**
 * Find the road edges nearest a trailhead.
 *
 * The database filter is a plane box that the R-tree index can answer, sized
 * so it always reaches at least the requested radius on the ground; the exact
 * distance is then measured properly and the over-wide candidates dropped.
 */
export async function snapTrailhead(
  store: RoadStore,
  options: SnapOptions,
): Promise<SnapCandidate[]> {
  const radius = options.radiusMetres ?? DEFAULT_SNAP_RADIUS_M;
  const limit = options.limit ?? 8;
  const cosLat = Math.max(Math.cos(options.lat * (Math.PI / 180)), 0.02);
  const radiusDegrees = radius / (METRES_PER_DEGREE_LAT * cosLat);

  const rows = await store.all<{
    edge_id: string;
    segment_key: string;
    source: string;
    route_id: string | null;
    name: string | null;
    from_node: number;
    to_node: number;
    near_lon: number;
    near_lat: number;
    position: number;
    vehicle_requirement: string | null;
    vehicle_rank: number | null;
    surface: string | null;
    surface_rank: number | null;
    maint_level: string | null;
    maint_level_num: number | null;
  }>(`WITH probe AS (
        SELECT ST_Point(${sqlLiteral(options.lon)}, ${sqlLiteral(options.lat)}) AS pt
      ), near AS (
        SELECT e.*, p.pt,
               ST_LineLocatePoint(e.geom::LINESTRING_2D, p.pt) AS position
        FROM road_edge e, probe p
        WHERE ST_DWithin(e.geom, p.pt, ${sqlLiteral(radiusDegrees)})
      )
      SELECT edge_id, segment_key, source, route_id, name, from_node, to_node,
             ST_X(ST_LineInterpolatePoint(geom::LINESTRING_2D, position)) AS near_lon,
             ST_Y(ST_LineInterpolatePoint(geom::LINESTRING_2D, position)) AS near_lat,
             position,
             vehicle_requirement, vehicle_rank, surface, surface_rank,
             maint_level, maint_level_num
      FROM near`);

  const probe = { lon: options.lon, lat: options.lat };
  return rows
    .map((row) => ({
      edgeId: row.edge_id,
      segmentKey: row.segment_key,
      source: row.source,
      routeId: row.route_id,
      name: row.name,
      fromNode: row.from_node,
      toNode: row.to_node,
      distanceMetres: metresBetween(probe, { lon: row.near_lon, lat: row.near_lat }),
      positionAlongEdge: row.position,
      vehicleRequirement: row.vehicle_requirement,
      vehicleRank: row.vehicle_rank,
      surface: row.surface,
      surfaceRank: row.surface_rank,
      maintLevel: row.maint_level,
      maintLevelNum: row.maint_level_num,
    }))
    .filter((candidate) => candidate.distanceMetres <= radius)
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, limit);
}

/** One edge as the walk sees it: topology plus the attributes it aggregates. */
export interface TraversalEdge extends GraphEdge {
  /** `<source>:<GLOBALID or OBJECTID>`. Store this, not `edgeId`. */
  segmentKey: string;
  source: string;
  routeId: string | null;
  name: string | null;
  /** Null where the source carried no `GIS_MILES`. Never treat null as zero. */
  lengthMiles: number | null;
  vehicleRequirement: string | null;
  /** Null on 55% of BLM edges. Null means unknown, not "easy". */
  vehicleRank: number | null;
  surface: string | null;
  surfaceRank: number | null;
  maintLevel: string | null;
  maintLevelNum: number | null;
  /** True where the walk may stop: a maintenance level 4 or 5 road. */
  approachTerminus: boolean;
}

/** Read the whole edge table. A few hundred thousand rows, so read it once. */
export async function loadTraversalEdges(store: RoadStore): Promise<TraversalEdge[]> {
  const rows = await store.all<Record<string, any>>(
    `SELECT edge_id, segment_key, from_node, to_node, length_miles, source,
            route_id, name, vehicle_requirement, vehicle_rank, surface,
            surface_rank, maint_level, maint_level_num, approach_terminus
     FROM road_edge
     ORDER BY edge_id`,
  );
  return rows.map((row) => ({
    edgeId: row.edge_id,
    segmentKey: row.segment_key,
    fromNode: row.from_node,
    toNode: row.to_node,
    lengthMiles: row.length_miles ?? null,
    source: row.source,
    routeId: row.route_id ?? null,
    name: row.name ?? null,
    vehicleRequirement: row.vehicle_requirement ?? null,
    vehicleRank: row.vehicle_rank ?? null,
    surface: row.surface ?? null,
    surfaceRank: row.surface_rank ?? null,
    maintLevel: row.maint_level ?? null,
    maintLevelNum: row.maint_level_num ?? null,
    approachTerminus: row.approach_terminus === true,
  }));
}

/** Convenience: edges keyed by id, for a walk that carries ids rather than objects. */
export function indexEdges(edges: readonly TraversalEdge[]): Map<string, TraversalEdge> {
  const index = new Map<string, TraversalEdge>();
  for (const edge of edges) index.set(edge.edgeId, edge);
  return index;
}

/** The other end of an edge from a node. Self-loops return the same node. */
export function otherNode(edge: GraphEdge, node: number): number {
  return edge.fromNode === node ? edge.toNode : edge.fromNode;
}

/** The worst value found on a path, and the segment that set it. */
export interface LimitingValue<T> {
  value: T;
  rank: number;
  /** The agency identifier to store as the answer's evidence. */
  limitingSegmentKey: string;
  /** This build's edge id. Useful for debugging, not for storage. */
  limitingEdgeId: string;
  /** The road's name, for the sentence the user reads. */
  limitingName: string | null;
  limitingRouteId: string | null;
}

/**
 * What an approach path adds up to.
 *
 * `vehicle` and `surface` are null when the answer is unknown, which is not
 * the same as "nothing was found" — see `unrankedEdges`. `lengthMiles` is null
 * when any edge on the path has no length.
 */
export interface ApproachSummary {
  vehicle: LimitingValue<string> | null;
  surface: LimitingValue<string> | null;
  lengthMiles: number | null;
  /** Edges with no vehicle rank. Any at all makes `vehicle` null. */
  unrankedEdges: number;
  /** Edges with no surface rank. Any at all makes `surface` null. */
  unsurfacedEdges: number;
  /** Edges with no length. Any at all makes `lengthMiles` null. */
  unmeasuredEdges: number;
  /** Every segment on the path, in order, deduplicated. */
  segmentKeys: string[];
}

/**
 * Apply the worst-on-the-path rule, and the unknown rule with it.
 *
 * The worst-on-the-path rule alone is not safe on this data. Taking a plain
 * maximum over a path where some edges have no rank quietly returns the
 * second-worst *known* edge, which reads as a confident answer and is not one.
 * So a single unranked edge makes the whole vehicle answer unknown, a single
 * unranked surface makes the surface answer unknown, and a single edge with no
 * length makes the distance unknown rather than short.
 *
 * The counts come back too, so a caller can say *why* it is unknown, and
 * `segmentKeys` gives the durable references for the whole path.
 *
 * A tie keeps the earlier edge: the comparison is strictly greater-than, so on
 * a path ordered from the trailhead outward the segment named is the first one
 * at the worst rank, not the last.
 */
export function summarizeApproach(path: readonly TraversalEdge[]): ApproachSummary {
  let vehicle: LimitingValue<string> | null = null;
  let surface: LimitingValue<string> | null = null;
  let unrankedEdges = 0;
  let unsurfacedEdges = 0;
  let unmeasuredEdges = 0;
  let miles = 0;
  const segmentKeys: string[] = [];
  const seenSegments = new Set<string>();

  for (const edge of path) {
    if (!seenSegments.has(edge.segmentKey)) {
      seenSegments.add(edge.segmentKey);
      segmentKeys.push(edge.segmentKey);
    }
    if (edge.lengthMiles === null) unmeasuredEdges += 1;
    else miles += edge.lengthMiles;

    if (edge.vehicleRank === null || edge.vehicleRequirement === null) {
      unrankedEdges += 1;
    } else if (vehicle === null || edge.vehicleRank > vehicle.rank) {
      vehicle = {
        value: edge.vehicleRequirement,
        rank: edge.vehicleRank,
        limitingSegmentKey: edge.segmentKey,
        limitingEdgeId: edge.edgeId,
        limitingName: edge.name,
        limitingRouteId: edge.routeId,
      };
    }

    if (edge.surfaceRank === null || edge.surface === null) {
      unsurfacedEdges += 1;
    } else if (surface === null || edge.surfaceRank > surface.rank) {
      surface = {
        value: edge.surface,
        rank: edge.surfaceRank,
        limitingSegmentKey: edge.segmentKey,
        limitingEdgeId: edge.edgeId,
        limitingName: edge.name,
        limitingRouteId: edge.routeId,
      };
    }
  }

  return {
    vehicle: unrankedEdges > 0 ? null : vehicle,
    surface: unsurfacedEdges > 0 ? null : surface,
    lengthMiles: unmeasuredEdges > 0 ? null : miles,
    unrankedEdges,
    unsurfacedEdges,
    unmeasuredEdges,
    segmentKeys,
  };
}

/** Re-exported so a caller needs one import to build and walk the graph. */
export { metresBetween };

/**
 * Where every node sits.
 *
 * A walk needs this to bound itself — "stop looking past 15 miles of straight
 * line from the trailhead" is the cheap guard that keeps a search inside a
 * large component from wandering across a whole national forest. Reading the
 * table once beats a query per step, and it saves the next task hand-rolling
 * the same SQL.
 */
export async function loadNodePositions(store: RoadStore): Promise<Map<number, Endpoint>> {
  const rows = await store.all<{ node_id: number; lon: number; lat: number }>(
    "SELECT node_id, lon, lat FROM road_node",
  );
  const positions = new Map<number, Endpoint>();
  for (const row of rows) positions.set(row.node_id, { lon: row.lon, lat: row.lat });
  return positions;
}

/** Straight-line metres between two nodes. Null if either is unknown. */
export function metresBetweenNodes(
  positions: Map<number, Endpoint>,
  a: number,
  b: number,
): number | null {
  const from = positions.get(a);
  const to = positions.get(b);
  if (from === undefined || to === undefined) return null;
  return metresBetween(from, to);
}

/** Everything a walk needs, read in one go. */
export async function loadGraph(store: RoadStore): Promise<{
  edges: TraversalEdge[];
  adjacency: ReturnType<typeof buildAdjacency>;
  byId: Map<string, TraversalEdge>;
  nodes: Map<number, Endpoint>;
}> {
  const [edges, nodes] = await Promise.all([
    loadTraversalEdges(store),
    loadNodePositions(store),
  ]);
  return { edges, adjacency: buildAdjacency(edges), byId: indexEdges(edges), nodes };
}
